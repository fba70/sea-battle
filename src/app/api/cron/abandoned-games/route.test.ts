import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * The maintenance route's authorisation, which is the whole reason it exists as a
 * separate endpoint: nothing else in the app may sweep rows any more, so this is the
 * only door — and it has to stay shut unless a scheduler with the secret knocks.
 */

const sweep = vi.fn(async () => 7);

vi.mock('@/lib/game/lobby-store', () => ({ createLobbyStore: () => ({}) }));
vi.mock('@/lib/game/lobby', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/game/lobby')>();
  return { ...actual, sweepAbandonedGames: sweep };
});

const env: { CRON_SECRET?: string } = {};
vi.mock('@/lib/env', () => ({ serverEnv: env }));

async function call(authorization?: string): Promise<Response> {
  const { GET } = await import('./route');
  return GET(
    new Request('https://seaduel.test/api/cron/abandoned-games', {
      headers: authorization === undefined ? {} : { authorization },
    }),
  );
}

beforeEach(() => {
  sweep.mockClear();
  delete env.CRON_SECRET;
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

describe('authorisation', () => {
  it('refuses to run at all when no secret is configured', async () => {
    const response = await call('Bearer anything');

    // Fails closed: a developer machine has no secret, so nothing here can rewrite
    // rows during ordinary work.
    expect(response.status).toBe(503);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('refuses a request with no credentials', async () => {
    env.CRON_SECRET = 'a-sufficiently-long-secret';

    expect((await call()).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret', async () => {
    env.CRON_SECRET = 'a-sufficiently-long-secret';

    expect((await call('Bearer not-the-secret')).status).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('runs the sweep for the scheduler, and says how much it closed', async () => {
    env.CRON_SECRET = 'a-sufficiently-long-secret';

    const response = await call('Bearer a-sufficiently-long-secret');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'swept', closed: 7 });
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});
