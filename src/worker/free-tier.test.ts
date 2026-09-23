import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Guards the two commitments that keep the realtime layer on Cloudflare's Free plan,
 * and keeps wrangler.jsonc from drifting away from the test runtime's own config.
 *
 * Durable Objects are only available on the Free plan with the **SQLite** storage
 * backend. `new_classes` in a migration selects the KV-backed backend instead, which
 * requires a paid plan — so its presence is a billing regression, not a style choice.
 */
function readJsonc(path: string): unknown {
  const source = readFileSync(path, 'utf8')
    // Whole-line comments, then trailing ones that are not inside a string.
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:"'])\/\/.*$/gm, '$1')
    // JSONC allows trailing commas; JSON.parse does not, and prettier adds them.
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(source);
}

const wrangler = readJsonc('wrangler.jsonc') as {
  main: string;
  compatibility_date: string;
  durable_objects?: { bindings: { name: string; class_name: string }[] };
  migrations?: { tag: string; new_sqlite_classes?: string[]; new_classes?: string[] }[];
};

describe('wrangler configuration stays on the Free plan', () => {
  it('declares the Durable Object with the SQLite backend', () => {
    const sqliteClasses = (wrangler.migrations ?? []).flatMap(
      (migration) => migration.new_sqlite_classes ?? [],
    );
    expect(sqliteClasses).toContain('GameRoom');
  });

  it('never declares a KV-backed Durable Object, which is paid-plan only', () => {
    for (const migration of wrangler.migrations ?? []) {
      expect(migration.new_classes, `migration ${migration.tag}`).toBeUndefined();
    }
  });

  it('binds exactly one Durable Object namespace, for the game room', () => {
    expect(wrangler.durable_objects?.bindings).toEqual([
      { name: 'GAME_ROOM', class_name: 'GameRoom' },
    ]);
  });

  it('points at the worker entry point', () => {
    expect(wrangler.main).toBe('src/worker/index.ts');
  });

  it('declares no other paid-only resource bindings', () => {
    // Nothing in Block 5 needs Redis, queues, KV, R2 or D1. If one appears, it should
    // be a deliberate decision with its own free-tier review.
    const config = wrangler as Record<string, unknown>;
    for (const key of ['kv_namespaces', 'r2_buckets', 'd1_databases', 'queues', 'hyperdrive']) {
      expect(config[key], key).toBeUndefined();
    }
  });
});

describe('the test runtime matches the deployed configuration', () => {
  const vitestConfig = readFileSync('vitest.workers.config.ts', 'utf8');

  it('uses the same Durable Object binding and class', () => {
    expect(vitestConfig).toContain("GAME_ROOM: { className: 'GameRoom'");
  });

  it('uses the SQLite backend in tests too, so the tests prove the free-tier path', () => {
    expect(vitestConfig).toContain('useSQLite: true');
  });

  it('uses the same compatibility date', () => {
    expect(vitestConfig).toContain(`compatibilityDate: '${wrangler.compatibility_date}'`);
  });

  it('runs the same worker entry point', () => {
    expect(vitestConfig).toContain(`main: './${wrangler.main}'`);
  });
});
