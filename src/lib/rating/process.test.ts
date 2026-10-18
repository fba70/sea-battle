import { describe, expect, it, vi } from 'vitest';

import { INITIAL_RATING, inflateRd, MAX_RD, rateHeadToHead, SCORE } from '@/rating/glicko';

import { decideRatingEligibility, type StoredGameForRating } from './eligibility';
import { GLICKO_SYSTEM_CONSTANT } from './policy';
import {
  processFinishedGame,
  type ApplyRatedResultInput,
  type RatingSnapshot,
  type RatingStore,
} from './process';

const PLAYER_A = 'user-a';
const PLAYER_B = 'user-b';
const GAME_ID = 'game-1';

/** When the game being rated ended; also the instant RD inflation is measured to. */
const RATED_AT = new Date('2026-09-22T12:00:00Z');

/** A player who has just played: no elapsed time, so no RD inflation. */
function active(userId: string, rating: number, rd: number): RatingSnapshot {
  return { userId, rating, rd, lastRatingPeriodAt: RATED_AT };
}

/** A player whose last rated match was `days` before the game being rated. */
function awayFor(userId: string, rating: number, rd: number, days: number): RatingSnapshot {
  return {
    userId,
    rating,
    rd,
    lastRatingPeriodAt: new Date(RATED_AT.getTime() - days * 24 * 60 * 60 * 1000),
  };
}

function storedGame(overrides: Partial<StoredGameForRating> = {}): StoredGameForRating {
  return {
    id: GAME_ID,
    mode: 'classic',
    type: 'quickmatch',
    status: 'completed',
    rated: true,
    playerAId: PLAYER_A,
    playerBId: PLAYER_B,
    winnerId: PLAYER_A,
    endedAt: RATED_AT,
    ratingDeltaA: null,
    ratingDeltaB: null,
    playerAIsAnonymous: false,
    playerBIsAnonymous: false,
    ...overrides,
  };
}

/** Records what the processor asked the database to do. */
function fakeStore(
  options: {
    game?: StoredGameForRating | null;
    ratings?: readonly RatingSnapshot[];
    applied?: boolean;
  } = {},
) {
  const applications: ApplyRatedResultInput[] = [];
  const store: RatingStore = {
    loadGame: async () => (options.game === undefined ? storedGame() : options.game),
    loadRatings: async () => options.ratings ?? [],
    applyRatedResult: async (input) => {
      applications.push(input);
      return { applied: options.applied ?? true };
    },
  };
  return { store, applications };
}

describe('eligibility (spec §4, §7.6)', () => {
  it('accepts a completed, rated, two-member game', () => {
    const decision = decideRatingEligibility(storedGame());

    expect(decision).toMatchObject({ eligible: true, scoreForA: 1, mode: 'classic' });
  });

  it('scores seat B winning as a loss for seat A', () => {
    const decision = decideRatingEligibility(storedGame({ winnerId: PLAYER_B }));
    expect(decision.eligible && decision.scoreForA).toBe(0);
  });

  const REJECTED: readonly [string, Partial<StoredGameForRating>, string][] = [
    ['an unrated game', { rated: false }, 'not_rated'],
    ['a bot game', { type: 'bot', playerBId: null }, 'bot_game'],
    ['a bot game flagged rated anyway', { type: 'bot', rated: true }, 'bot_game'],
    ['a game still in play', { status: 'live', winnerId: null, endedAt: null }, 'not_completed'],
    ['an aborted game', { status: 'aborted' }, 'not_completed'],
    ['a game already rated', { ratingDeltaA: 5, ratingDeltaB: -5 }, 'already_processed'],
    ['a half-written delta', { ratingDeltaA: 5 }, 'already_processed'],
    ['a vacant seat', { playerBId: null }, 'missing_player'],
    ['an erased account', { playerAId: null }, 'missing_player'],
    ['a guest in seat A', { playerAIsAnonymous: true }, 'guest_player'],
    ['a guest in seat B', { playerBIsAnonymous: true }, 'guest_player'],
    ['an unknown guest flag', { playerAIsAnonymous: null }, 'guest_player'],
    ['no winner', { winnerId: null }, 'no_winner'],
    ['a winner who did not play', { winnerId: 'someone-else' }, 'winner_not_a_player'],
    ['no end time', { endedAt: null }, 'missing_end_time'],
  ];

  for (const [label, overrides, reason] of REJECTED) {
    it(`rejects ${label} with reason ${reason}`, () => {
      const decision = decideRatingEligibility(storedGame(overrides));

      expect(decision.eligible).toBe(false);
      expect(!decision.eligible && decision.reason).toBe(reason);
    });
  }
});

describe('guests, bots and unrated games never move a rating (spec §4)', () => {
  const UNRATEABLE: readonly [string, Partial<StoredGameForRating>][] = [
    ['an unrated private game', { rated: false, type: 'private' }],
    ['a bot game', { type: 'bot', playerBId: null, rated: false }],
    ['a guest quick-match', { playerBIsAnonymous: true }],
    ['a game with both players guests', { playerAIsAnonymous: true, playerBIsAnonymous: true }],
  ];

  for (const [label, overrides] of UNRATEABLE) {
    it(`writes nothing for ${label}`, async () => {
      const { store, applications } = fakeStore({ game: storedGame(overrides) });
      const outcome = await processFinishedGame(store, GAME_ID);

      expect(outcome.status).toBe('skipped');
      // The decisive assertion: no write was even attempted.
      expect(applications).toEqual([]);
    });
  }
});

describe('processFinishedGame', () => {
  it('reports a missing game rather than throwing', async () => {
    const { store } = fakeStore({ game: null });
    expect(await processFinishedGame(store, GAME_ID)).toEqual({
      status: 'not_found',
      gameId: GAME_ID,
    });
  });

  it('starts both players at 1500/350 when they have no rating row yet', async () => {
    const { store, applications } = fakeStore({ ratings: [] });
    await processFinishedGame(store, GAME_ID);

    const expected = rateHeadToHead(INITIAL_RATING, INITIAL_RATING, SCORE.win);
    expect(applications[0]?.a.next).toEqual(expected.a);
    expect(applications[0]?.b.next).toEqual(expected.b);
  });

  it('rates both players from the same pre-match state', async () => {
    const before = {
      a: active(PLAYER_A, 1620, 80),
      b: active(PLAYER_B, 1440, 210),
    };
    const { store, applications } = fakeStore({ ratings: [before.a, before.b] });

    await processFinishedGame(store, GAME_ID);

    // Seat B must be rated against seat A's rating *before* this game, not after.
    const expected = rateHeadToHead({ rating: 1620, rd: 80 }, { rating: 1440, rd: 210 }, SCORE.win);
    expect(applications[0]?.a.next).toEqual(expected.a);
    expect(applications[0]?.b.next).toEqual(expected.b);
    expect(applications[0]?.a.delta).toBeCloseTo(expected.deltaA, 12);
    expect(applications[0]?.b.delta).toBeCloseTo(expected.deltaB, 12);
  });

  it('matches each stored rating to the right seat regardless of row order', async () => {
    const ratings = [active(PLAYER_B, 1440, 210), active(PLAYER_A, 1620, 80)];
    const { store, applications } = fakeStore({ ratings });

    await processFinishedGame(store, GAME_ID);

    expect(applications[0]?.a.userId).toBe(PLAYER_A);
    expect(applications[0]?.a.next.rating).toBeGreaterThan(1620);
    expect(applications[0]?.b.userId).toBe(PLAYER_B);
    expect(applications[0]?.b.next.rating).toBeLessThan(1440);
  });

  it('returns the deltas it stored, signed for winner and loser', async () => {
    const { store, applications } = fakeStore();
    const outcome = await processFinishedGame(store, GAME_ID);

    expect(outcome.status).toBe('applied');
    if (outcome.status !== 'applied') {
      return;
    }
    expect(outcome.deltaA).toBeGreaterThan(0);
    expect(outcome.deltaB).toBeLessThan(0);
    // Exactly what goes into games.rating_delta_a / _b.
    expect(applications[0]?.a.delta).toBe(outcome.deltaA);
    expect(applications[0]?.b.delta).toBe(outcome.deltaB);
  });

  it('stamps the rating period from the game, not from a clock', async () => {
    // Keeps processing replayable and independent of when the retry happens.
    const endedAt = new Date('2026-01-02T03:04:05Z');
    const { store, applications } = fakeStore({ game: storedGame({ endedAt }) });

    await processFinishedGame(store, GAME_ID);
    expect(applications[0]?.ratedAt).toBe(endedAt);
  });

  it('carries the game mode through, so Salvo needs no new code path', async () => {
    const { store, applications } = fakeStore({ game: storedGame({ mode: 'salvo' }) });
    await processFinishedGame(store, GAME_ID);

    expect(applications[0]?.mode).toBe('salvo');
  });

  it('derives everything from the stored game — the caller supplies only an id', async () => {
    // A forfeit is rated exactly like a normal loss (spec §7.6).
    const { store, applications } = fakeStore({
      game: storedGame({ winnerId: PLAYER_B }),
    });
    const outcome = await processFinishedGame(store, GAME_ID);

    expect(outcome.status).toBe('applied');
    expect(applications[0]?.a.delta).toBeLessThan(0);
    expect(applications[0]?.b.delta).toBeGreaterThan(0);
  });

  it('is deterministic for the same stored state', async () => {
    const ratings = [awayFor(PLAYER_A, 1573.2, 142.8, 11.25), active(PLAYER_B, 1498.6, 97.1)];
    const first = await processFinishedGame(fakeStore({ ratings }).store, GAME_ID);
    const second = await processFinishedGame(fakeStore({ ratings }).store, GAME_ID);

    expect(first).toEqual(second);
  });
});

describe('exactly-once processing', () => {
  it('reports already_processed when the compare-and-set loses the race', async () => {
    // What a concurrent second caller sees: it computed the same numbers, then the
    // store's CAS matched no rows because the first caller had already claimed it.
    const { store } = fakeStore({ applied: false });
    const outcome = await processFinishedGame(store, GAME_ID);

    expect(outcome).toEqual({ status: 'already_processed', gameId: GAME_ID });
  });

  it('skips before any write once the deltas are stored', async () => {
    // The cheap path for an ordinary retry: eligibility sees the deltas and stops.
    const { store, applications } = fakeStore({
      game: storedGame({ ratingDeltaA: 11.2, ratingDeltaB: -11.2 }),
    });
    const outcome = await processFinishedGame(store, GAME_ID);

    expect(outcome).toEqual({ status: 'skipped', gameId: GAME_ID, reason: 'already_processed' });
    expect(applications).toEqual([]);
  });

  it('never awards rating twice across a sequential retry', async () => {
    // First call wins and writes the deltas; the store then reflects that, and the
    // second call short-circuits.
    let game = storedGame();
    const applications: ApplyRatedResultInput[] = [];
    const store: RatingStore = {
      loadGame: async () => game,
      loadRatings: async () => [],
      applyRatedResult: async (input) => {
        applications.push(input);
        game = storedGame({ ratingDeltaA: input.a.delta, ratingDeltaB: input.b.delta });
        return { applied: true };
      },
    };

    const first = await processFinishedGame(store, GAME_ID);
    const second = await processFinishedGame(store, GAME_ID);

    expect(first.status).toBe('applied');
    expect(second.status).toBe('skipped');
    expect(applications).toHaveLength(1);
  });

  it('only one of several concurrent callers applies the result', async () => {
    let claimed = false;
    const applications: ApplyRatedResultInput[] = [];
    const store: RatingStore = {
      loadGame: async () => storedGame(),
      loadRatings: async () => [],
      applyRatedResult: async (input) => {
        applications.push(input);
        // Stands in for the database CAS: the first writer wins, the rest see zero rows.
        if (claimed) {
          return { applied: false };
        }
        claimed = true;
        return { applied: true };
      },
    };

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => processFinishedGame(store, GAME_ID)),
    );

    expect(outcomes.filter((outcome) => outcome.status === 'applied')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'already_processed')).toHaveLength(4);
    // All five computed the same numbers from the same pre-match state, so whichever
    // won the race stored an identical result.
    const deltas = new Set(applications.map((input) => input.a.delta));
    expect(deltas.size).toBe(1);
  });
});

describe('inactivity inflates RD before the game is rated (spec §7.6)', () => {
  /** What the player's RD grows to after `days` away, straight from the policy. */
  const inflated = (rd: number, days: number) => inflateRd(rd, GLICKO_SYSTEM_CONSTANT, days);

  it('leaves an active player exactly as they were', async () => {
    const { store, applications } = fakeStore({
      ratings: [active(PLAYER_A, 1700, 65), active(PLAYER_B, 1680, 70)],
    });
    await processFinishedGame(store, GAME_ID);

    // The regression that matters: adding inflation must not move anyone who played
    // today. Zero elapsed periods, so these are the raw stored deviations.
    const expected = rateHeadToHead({ rating: 1700, rd: 65 }, { rating: 1680, rd: 70 }, SCORE.win);
    expect(applications[0]?.a.next).toEqual(expected.a);
    expect(applications[0]?.b.next).toEqual(expected.b);
  });

  it('rates a returning player from their grown RD, not their stored one', async () => {
    const { store, applications } = fakeStore({
      ratings: [awayFor(PLAYER_A, 1700, 60, 90), active(PLAYER_B, 1700, 60)],
    });
    await processFinishedGame(store, GAME_ID);

    const expected = rateHeadToHead(
      { rating: 1700, rd: inflated(60, 90) },
      { rating: 1700, rd: 60 },
      SCORE.win,
    );
    expect(applications[0]?.a.next.rating).toBeCloseTo(expected.a.rating, 12);
    expect(applications[0]?.a.next.rd).toBeCloseTo(expected.a.rd, 12);
    // c = 15 over 90 daily periods: RD 60 grows to about 154.
    expect(inflated(60, 90)).toBeCloseTo(154.4, 1);
  });

  it("inflates the opponent's RD too, not just the returning player's", async () => {
    const { store, applications } = fakeStore({
      ratings: [awayFor(PLAYER_A, 1500, 60, 40), awayFor(PLAYER_B, 1500, 60, 40)],
    });
    await processFinishedGame(store, GAME_ID);

    const grown = inflated(60, 40);
    const expected = rateHeadToHead(
      { rating: 1500, rd: grown },
      { rating: 1500, rd: grown },
      SCORE.win,
    );
    expect(applications[0]?.b.next.rd).toBeCloseTo(expected.b.rd, 12);
  });

  it('moves a long-absent player further than a recently active one', async () => {
    const deltaAfter = async (days: number) => {
      const { store, applications } = fakeStore({
        ratings: [awayFor(PLAYER_A, 1500, 60, days), active(PLAYER_B, 1500, 60)],
      });
      await processFinishedGame(store, GAME_ID);
      return applications[0]?.a.delta ?? 0;
    };

    const [fresh, month, half] = await Promise.all([
      deltaAfter(0),
      deltaAfter(30),
      deltaAfter(180),
    ]);
    expect(month).toBeGreaterThan(fresh);
    expect(half).toBeGreaterThan(month);
  });

  it('never inflates past the Glicko maximum, however long the absence', async () => {
    const { store, applications } = fakeStore({
      ratings: [awayFor(PLAYER_A, 1500, 60, 10_000), active(PLAYER_B, 1500, 60)],
    });
    await processFinishedGame(store, GAME_ID);

    // Ten thousand days away is indistinguishable from a brand-new player.
    const expected = rateHeadToHead(
      { rating: 1500, rd: MAX_RD },
      { rating: 1500, rd: 60 },
      SCORE.win,
    );
    expect(applications[0]?.a.next.rd).toBeCloseTo(expected.a.rd, 12);
  });

  it('measures elapsed time from the game, so a late retry is identical', async () => {
    const ratings = [awayFor(PLAYER_A, 1612, 74, 45), active(PLAYER_B, 1544, 118)];

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-22T12:00:01Z'));
      const prompt = fakeStore({ ratings });
      await processFinishedGame(prompt.store, GAME_ID);

      // The same game reprocessed a year later must produce the same numbers.
      vi.setSystemTime(new Date('2027-09-22T12:00:01Z'));
      const late = fakeStore({ ratings });
      await processFinishedGame(late.store, GAME_ID);

      expect(late.applications[0]?.a).toEqual(prompt.applications[0]?.a);
      expect(late.applications[0]?.b).toEqual(prompt.applications[0]?.b);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not inflate a rating row that has never been through a rated match', async () => {
    const { store, applications } = fakeStore({
      ratings: [
        { userId: PLAYER_A, rating: 1500, rd: 350, lastRatingPeriodAt: null },
        active(PLAYER_B, 1500, 60),
      ],
    });
    await processFinishedGame(store, GAME_ID);

    const expected = rateHeadToHead({ rating: 1500, rd: 350 }, { rating: 1500, rd: 60 }, SCORE.win);
    expect(applications[0]?.a.next).toEqual(expected.a);
  });

  it('still starts a player with no rating row at all at 1500 / RD 350', async () => {
    const { store, applications } = fakeStore({ ratings: [awayFor(PLAYER_B, 1500, 60, 365)] });
    await processFinishedGame(store, GAME_ID);

    expect(applications[0]?.a.next).toEqual(
      rateHeadToHead(INITIAL_RATING, { rating: 1500, rd: inflated(60, 365) }, SCORE.win).a,
    );
  });
});
