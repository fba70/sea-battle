import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { createRatingStore } from './rating-store';
import type { ApplyRatedResultInput } from './process';

/**
 * Pins the SQL the rating write actually emits, without a database.
 *
 * The statement is where atomicity and exactly-once live, and none of that is visible
 * to a type check. The shape asserted here was additionally validated with `EXPLAIN`
 * against the live Neon schema: the planner resolves the compare-and-set to an index
 * scan on `games_pkey` with the delta-is-null filter, arbitrates both upserts on
 * `ratings_user_id_mode_pk`, and drives both inserts from a `CTE Scan on claimed`.
 */
const dialect = new PgDialect();

const INPUT: ApplyRatedResultInput = {
  gameId: '00000000-0000-0000-0000-000000000001',
  mode: 'classic',
  ratedAt: new Date('2026-09-22T12:00:00Z'),
  a: { userId: 'user-a', next: { rating: 1512.3, rd: 289.1 }, delta: 12.3 },
  b: { userId: 'user-b', next: { rating: 1487.7, rd: 289.1 }, delta: -12.3 },
};

async function captureApply(input: ApplyRatedResultInput = INPUT) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const database = {
    execute: async (query: unknown) => {
      statements.push(dialect.sqlToQuery(query as never));
      return { rows: [{ claimed: 1, rated_a: 1, rated_b: 1 }] };
    },
  };

  const store = createRatingStore(database as unknown as Parameters<typeof createRatingStore>[0]);
  const result = await store.applyRatedResult(input);

  return { statements, result };
}

describe('applyRatedResult is a single atomic statement', () => {
  it('issues exactly one statement, so no partial state can exist', async () => {
    const { statements } = await captureApply();
    expect(statements).toHaveLength(1);
  });

  it('claims the game with a compare-and-set on the still-null deltas', async () => {
    const { statements } = await captureApply();
    const query = statements[0]?.sql.toLowerCase() ?? '';

    expect(query).toContain('with claimed as');
    expect(query).toContain('update "games"');
    expect(query).toContain('"rating_delta_a" is null');
    expect(query).toContain('"rating_delta_b" is null');
  });

  it('refuses to claim a game that is not rated and completed', async () => {
    const { statements } = await captureApply();
    const query = statements[0]?.sql.toLowerCase() ?? '';

    // Belt and braces alongside the eligibility check: even a caller that bypassed
    // `processFinishedGame` cannot rate an unrated or unfinished game.
    expect(query).toContain('"rated" = true');
    expect(query).toContain(`"status" = 'completed'`);
  });

  it('writes both deltas onto the game', async () => {
    const { statements } = await captureApply();

    expect(statements[0]?.sql).toContain('"rating_delta_a" = $1');
    expect(statements[0]?.sql).toContain('"rating_delta_b" = $2');
    expect(statements[0]?.params?.slice(0, 3)).toEqual([12.3, -12.3, INPUT.gameId]);
  });
});

describe('the rating writes depend on winning the claim', () => {
  it('drives both upserts from the claimed CTE', async () => {
    // This is the idempotency mechanism: if the CAS matched no rows, `claimed` is
    // empty, so `select ... from claimed` inserts nothing and updates nothing.
    const { statements } = await captureApply();
    const query = statements[0]?.sql.toLowerCase() ?? '';

    expect(query.match(/from claimed/g)).toHaveLength(3);
    expect(query).toContain('rated_a as');
    expect(query).toContain('rated_b as');
  });

  it('upserts on the Block 2 composite key so a first-time player gets a row', async () => {
    const { statements } = await captureApply();
    const query = statements[0]?.sql.toLowerCase() ?? '';

    expect(query).toContain('on conflict ("user_id", "mode") do update');
  });

  it('increments games_rated rather than overwriting it', async () => {
    const { statements } = await captureApply();
    const query = statements[0]?.sql.toLowerCase() ?? '';

    expect(query).toContain('"games_rated" = "ratings"."games_rated" + 1');
  });

  it('records the rating-period stamp for the inactivity work still to come', async () => {
    const { statements } = await captureApply();
    const query = statements[0]?.sql.toLowerCase() ?? '';

    expect(query).toContain('"last_rating_period_at"');
    // No system constant, period length or inflation is encoded here — §7.6 leaves
    // all three open and this block does not decide them.
    expect(query).not.toContain('sqrt');
  });

  it('sends each player their own rating and deviation', async () => {
    const { statements } = await captureApply();
    const params = statements[0]?.params ?? [];

    expect(params).toContain('user-a');
    expect(params).toContain('user-b');
    expect(params).toContain(1512.3);
    expect(params).toContain(1487.7);
  });

  it('parameterises every value — nothing is interpolated into the SQL', async () => {
    const { statements } = await captureApply();

    expect(statements[0]?.sql).not.toContain('user-a');
    expect(statements[0]?.sql).not.toContain(INPUT.gameId);
    expect(statements[0]?.params).toHaveLength(15);
  });
});

describe('applyRatedResult reports whether it won the claim', () => {
  it('reports applied when the game was claimed', async () => {
    const { result } = await captureApply();
    expect(result).toEqual({ applied: true });
  });

  it('reports not applied when another caller already rated the game', async () => {
    const database = {
      execute: async () => ({ rows: [{ claimed: 0, rated_a: 0, rated_b: 0 }] }),
    };
    const store = createRatingStore(database as unknown as Parameters<typeof createRatingStore>[0]);

    expect(await store.applyRatedResult(INPUT)).toEqual({ applied: false });
  });

  it('treats an empty result as not applied rather than assuming success', async () => {
    const database = { execute: async () => ({ rows: [] }) };
    const store = createRatingStore(database as unknown as Parameters<typeof createRatingStore>[0]);

    expect(await store.applyRatedResult(INPUT)).toEqual({ applied: false });
  });
});

describe('loadGame reads the authoritative row and both guest flags', () => {
  it('selects the guest flags alongside the game in one read', async () => {
    const captured: { sql: string }[] = [];
    const database = {
      select: (fields: Record<string, unknown>) => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              captured.push({ sql: Object.keys(fields).join(',') });
              return [];
            },
          }),
        }),
      }),
    };

    const store = createRatingStore(database as unknown as Parameters<typeof createRatingStore>[0]);
    expect(await store.loadGame('game-1')).toBeNull();

    // Eligibility needs these, and reading them separately would risk an
    // inconsistent view of who is a guest.
    expect(captured[0]?.sql).toContain('playerAIsAnonymous');
    expect(captured[0]?.sql).toContain('playerBIsAnonymous');
    expect(captured[0]?.sql).toContain('ratingDeltaA');
  });
});
