import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { LEADERBOARD_MAX_RD, LEADERBOARD_MIN_RATED_GAMES } from '../rating/policy';
import { createLeaderboardStore } from './leaderboard-store';

/**
 * Pins the SQL the leaderboard reads emit, and the way their rows are mapped, without
 * a database. The statements were additionally run against the live Neon schema, which
 * is what proves they are valid Postgres; these assertions are about the properties
 * that must not regress silently.
 */
const dialect = new PgDialect();

type Row = Record<string, unknown>;

/** A database stub that records every statement and replays canned rows in order. */
function fakeDb(responses: Row[][]) {
  const statements: { sql: string; params: unknown[] }[] = [];
  let call = 0;

  const database = {
    execute: async (query: unknown) => {
      statements.push(dialect.sqlToQuery(query as never));
      const rows = responses[call] ?? [];
      call += 1;
      return { rows };
    },
  };

  return {
    statements,
    store: createLeaderboardStore(
      database as unknown as Parameters<typeof createLeaderboardStore>[0],
    ),
  };
}

const NOW = new Date('2026-10-18T09:00:00Z');

describe('topPlayers', () => {
  it('orders by spec §7.7 and breaks the final tie deterministically', async () => {
    const { store, statements } = fakeDb([[]]);
    await store.topPlayers({ mode: 'classic', limit: 50, now: NOW });

    const sql = statements[0]?.sql ?? '';
    // Rating desc, then the *inflated* RD asc, then games desc, then a stable id.
    expect(sql).toMatch(
      /order by "ratings"\."rating" desc, least\(sqrt\(.+\) asc, "ratings"\."games_rated" desc, "ratings"\."user_id" asc/s,
    );
  });

  it('filters with the Block 8A eligibility predicate, not its own thresholds', async () => {
    const { store, statements } = fakeDb([[]]);
    await store.topPlayers({ mode: 'classic', limit: 50, now: NOW });

    const { sql, params } = statements[0] as { sql: string; params: unknown[] };
    expect(sql).toContain('"ratings"."last_rating_period_at" is not null');
    expect(params).toContain(LEADERBOARD_MIN_RATED_GAMES);
    expect(params).toContain(LEADERBOARD_MAX_RD);
  });

  it('derives wins and losses from games rather than a counter', async () => {
    const { store, statements } = fakeDb([[]]);
    await store.topPlayers({ mode: 'classic', limit: 50, now: NOW });

    const sql = statements[0]?.sql ?? '';
    expect(sql).toContain('cross join lateral');
    expect(sql).toMatch(/count\(\*\) filter \(where "games"\."winner_id" = ranked\.user_id\)/);
    // Only decided, rated, completed games of this mode count toward the record.
    expect(sql).toContain('"games"."rated" = true');
    expect(sql).toContain(`"games"."status" = 'completed'`);
  });

  it('never selects the stored board state', async () => {
    const { store, statements } = fakeDb([[]]);
    await store.topPlayers({ mode: 'classic', limit: 50, now: NOW });

    // games.boards_json holds BOTH fleets. It must not leave the server.
    expect(statements[0]?.sql).not.toContain('boards_json');
  });

  it('maps a row into an entry, coercing the driver numerics', async () => {
    const { store } = fakeDb([
      [
        {
          rank: '1',
          user_id: 'user-a',
          name: 'Ada',
          country: 'DE',
          avatar_seed: 'seed-a',
          rating: '1702.5',
          rd: '71.25',
          games_rated: '31',
          wins: '20',
          losses: '11',
        },
      ],
    ]);

    expect(await store.topPlayers({ mode: 'classic', limit: 50, now: NOW })).toEqual([
      {
        rank: 1,
        userId: 'user-a',
        name: 'Ada',
        country: 'DE',
        avatarSeed: 'seed-a',
        rating: 1702.5,
        rd: 71.25,
        gamesRated: 31,
        wins: 20,
        losses: 11,
      },
    ]);
  });
});

describe('standing', () => {
  const row = (overrides: Row = {}): Row => ({
    user_id: 'user-a',
    name: 'Ada',
    country: null,
    avatar_seed: null,
    rating: '1540',
    stored_rd: '70',
    games_rated: '18',
    last_rating_period_at: '2026-10-17T09:00:00.000Z',
    wins: '10',
    losses: '8',
    ...overrides,
  });

  it('returns null for an account that does not exist', async () => {
    const { store } = fakeDb([[]]);
    expect(await store.standing({ userId: 'nobody', mode: 'classic', now: NOW })).toBeNull();
  });

  it('is driven from the account, not from the rating', async () => {
    /**
     * The regression: a rating row only appears once a player's first rated game is
     * scored, so starting the query from `ratings` left a newly registered player
     * with no profile at all — and the link in our own header 404'd.
     */
    const { store, statements } = fakeDb([[]]);
    await store.standing({ userId: 'user-a', mode: 'classic', now: NOW });

    const sql = statements[0]?.sql ?? '';
    expect(sql).toMatch(/from "user"\s+left join "ratings"/);
    // Guests cannot hold a rating and their identity is a throwaway.
    expect(sql).toContain('"user"."is_anonymous" = false');
  });

  it('gives a player who has never been rated the starting values', async () => {
    const { store, statements } = fakeDb([
      [
        row({
          rating: '1500',
          stored_rd: '350',
          games_rated: '0',
          last_rating_period_at: null,
          wins: '0',
          losses: '0',
        }),
      ],
    ]);

    const standing = await store.standing({ userId: 'user-a', mode: 'classic', now: NOW });

    expect(standing).toMatchObject({
      rating: 1500,
      rd: 350,
      gamesRated: 0,
      rank: null,
      eligibility: { eligible: false, reason: 'never_rated' },
    });
    // No rank lookup for someone who cannot be ranked.
    expect(statements).toHaveLength(1);
  });

  it('ranks an eligible player with the same ordering the board uses', async () => {
    const { store, statements } = fakeDb([[row()], [{ rank: '4' }]]);
    const standing = await store.standing({ userId: 'user-a', mode: 'classic', now: NOW });

    expect(standing?.eligibility).toEqual({ eligible: true });
    expect(standing?.rank).toBe(4);
    // Second statement is the rank lookup, and it repeats the board's ORDER BY.
    expect(statements[1]?.sql).toContain('row_number() over');
    expect(statements[1]?.sql).toContain('"ratings"."user_id" asc');
  });

  it('reports the inflated RD alongside the stored one', async () => {
    // One day away at c = 15: sqrt(70² + 225) ≈ 71.6.
    const { store } = fakeDb([[row()], [{ rank: '4' }]]);
    const standing = await store.standing({ userId: 'user-a', mode: 'classic', now: NOW });

    expect(standing?.storedRd).toBe(70);
    expect(standing?.rd).toBeCloseTo(71.59, 2);
  });

  it('does not ask for a rank it cannot have', async () => {
    const { store, statements } = fakeDb([
      [row({ last_rating_period_at: '2026-08-01T09:00:00.000Z' })],
    ]);
    const standing = await store.standing({ userId: 'user-a', mode: 'classic', now: NOW });

    expect(standing?.eligibility).toEqual({ eligible: false, reason: 'inactive' });
    expect(standing?.rank).toBeNull();
    // An ineligible player is never looked up in the ranked set.
    expect(statements).toHaveLength(1);
  });

  it('excludes a player who is short of rated games', async () => {
    const { store } = fakeDb([[row({ games_rated: '4' })]]);
    const standing = await store.standing({ userId: 'user-a', mode: 'classic', now: NOW });

    expect(standing?.eligibility).toEqual({ eligible: false, reason: 'too_few_games' });
  });

  it('excludes a player whose RD has grown past the gate while away', async () => {
    // Stored RD 149 passes the gate; 20 days of inflation does not. Exactly the
    // staleness case the policy exists to prevent.
    const { store } = fakeDb([
      [row({ stored_rd: '149', last_rating_period_at: '2026-09-28T09:00:00.000Z' })],
    ]);
    const standing = await store.standing({ userId: 'user-a', mode: 'classic', now: NOW });

    expect(standing?.storedRd).toBeLessThan(LEADERBOARD_MAX_RD);
    expect(standing?.rd).toBeGreaterThan(LEADERBOARD_MAX_RD);
    expect(standing?.eligibility).toEqual({
      eligible: false,
      reason: 'rating_too_uncertain',
    });
  });
});

describe('history', () => {
  it('reads only completed games, for either seat, newest first', async () => {
    const { store, statements } = fakeDb([[]]);
    await store.history({ userId: 'user-a', limit: 20 });

    const sql = statements[0]?.sql ?? '';
    expect(sql).toContain(`"games"."status" = 'completed'`);
    expect(sql).toMatch(/"games"\."player_a_id" = \$\d+ or "games"\."player_b_id" = \$\d+/);
    expect(sql).toContain('order by "games"."ended_at" desc nulls last');
  });

  it('never selects the stored board state', async () => {
    const { store, statements } = fakeDb([[]]);
    await store.history({ userId: 'user-a', limit: 20 });

    expect(statements[0]?.sql).not.toContain('boards_json');
  });

  it('reports the result and the rating change from this player’s side', async () => {
    const { store } = fakeDb([
      [
        {
          game_id: 'game-1',
          mode: 'classic',
          type: 'quickmatch',
          rated: true,
          ended_at: '2026-10-17T18:30:00.000Z',
          winner_id: 'user-a',
          result_reason: 'sunk_all',
          move_count: 61,
          bot_level: null,
          rating_delta: '12.5',
          opponent_name: 'Grace',
        },
        {
          game_id: 'game-2',
          mode: 'classic',
          type: 'bot',
          rated: false,
          ended_at: '2026-10-16T18:30:00.000Z',
          winner_id: 'someone-else',
          result_reason: 'forfeit',
          move_count: 40,
          bot_level: 'hard',
          rating_delta: null,
          opponent_name: null,
        },
      ],
    ]);

    const [win, loss] = await store.history({ userId: 'user-a', limit: 20 });

    expect(win).toMatchObject({ won: true, ratingDelta: 12.5, opponentName: 'Grace', rated: true });
    expect(win?.endedAt?.toISOString()).toBe('2026-10-17T18:30:00.000Z');
    expect(loss).toMatchObject({ won: false, ratingDelta: null, botLevel: 'hard', type: 'bot' });
  });

  it('treats a game with no winner as undecided rather than a loss', async () => {
    const { store } = fakeDb([
      [
        {
          game_id: 'game-3',
          mode: 'classic',
          type: 'private',
          rated: false,
          ended_at: null,
          winner_id: null,
          result_reason: null,
          move_count: 0,
          bot_level: null,
          rating_delta: null,
          opponent_name: null,
        },
      ],
    ]);

    expect((await store.history({ userId: 'user-a', limit: 20 }))[0]).toMatchObject({
      won: null,
      endedAt: null,
    });
  });
});

describe('rankedCount', () => {
  it('counts the eligible set and nothing else', async () => {
    const { store, statements } = fakeDb([[{ ranked: 7 }]]);

    expect(await store.rankedCount({ mode: 'classic', now: NOW })).toBe(7);
    expect(statements[0]?.sql).toContain('count(*)');
    expect(statements[0]?.sql).toContain('"ratings"."games_rated" >= $');
  });

  it('reads an empty ladder as zero, not as a crash', async () => {
    const { store } = fakeDb([[]]);
    expect(await store.rankedCount({ mode: 'classic', now: NOW })).toBe(0);
  });
});
