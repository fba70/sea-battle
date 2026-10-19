import { describe, expect, it } from 'vitest';

import type { StoredGameForRating } from './eligibility';
import type { RatingSnapshot, RatingStore } from './process';
import { loadRatingReport } from './report';

const PLAYER_A = 'user-a';
const PLAYER_B = 'user-b';
const GAME_ID = 'game-1';

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
    endedAt: new Date('2026-10-18T12:00:00Z'),
    ratingDeltaA: 12.4,
    ratingDeltaB: -12.4,
    playerAIsAnonymous: false,
    playerBIsAnonymous: false,
    ...overrides,
  };
}

function snapshot(userId: string, rating: number, gamesRated: number): RatingSnapshot {
  return { userId, rating, rd: 90, lastRatingPeriodAt: new Date(), gamesRated };
}

function fakeStore(options: {
  game?: StoredGameForRating | null;
  ratings?: readonly RatingSnapshot[];
}): RatingStore {
  return {
    loadGame: async () => (options.game === undefined ? storedGame() : options.game),
    loadRatings: async () => options.ratings ?? [],
    applyRatedResult: async () => ({ applied: true }),
  };
}

describe('loadRatingReport', () => {
  it('reports both seats from the stored row', async () => {
    const store = fakeStore({
      ratings: [snapshot(PLAYER_A, 1512.4, 11), snapshot(PLAYER_B, 1487.6, 7)],
    });

    expect(await loadRatingReport(store, GAME_ID)).toEqual({
      rated: true,
      a: { delta: 12.4, rating: 1512.4, gamesRated: 11 },
      b: { delta: -12.4, rating: 1487.6, gamesRated: 7 },
    });
  });

  it('answers a retried report, which rated nothing but still owes the numbers', async () => {
    // The deltas come from the row, not from a calculation — which is exactly why a
    // second report, or a player reloading the page, can still be told.
    const store = fakeStore({
      ratings: [snapshot(PLAYER_A, 1512.4, 11), snapshot(PLAYER_B, 1487.6, 7)],
    });

    const first = await loadRatingReport(store, GAME_ID);
    expect(await loadRatingReport(store, GAME_ID)).toEqual(first);
  });

  it('says plainly that an unrated match was unrated', async () => {
    const store = fakeStore({ game: storedGame({ rated: false }) });
    expect(await loadRatingReport(store, GAME_ID)).toEqual({ rated: false });
  });

  it('treats a vanished game as unrated rather than throwing', async () => {
    expect(await loadRatingReport(fakeStore({ game: null }), GAME_ID)).toEqual({ rated: false });
  });

  it('leaves a seat null while its rating has not landed', async () => {
    // Half-applied is "not known", never zero: showing +0 would be a lie.
    const store = fakeStore({
      game: storedGame({ ratingDeltaB: null }),
      ratings: [snapshot(PLAYER_A, 1512.4, 11)],
    });

    const report = await loadRatingReport(store, GAME_ID);
    expect(report).toMatchObject({ rated: true, b: null });
    expect(report.rated && report.a).toMatchObject({ delta: 12.4 });
  });

  it('leaves a seat null when the delta is there but the rating row is not', async () => {
    const store = fakeStore({ ratings: [] });
    expect(await loadRatingReport(store, GAME_ID)).toMatchObject({ a: null, b: null });
  });

  it('reports an erased seat as unrated rather than guessing', async () => {
    const store = fakeStore({ game: storedGame({ playerBId: null }) });
    expect(await loadRatingReport(store, GAME_ID)).toEqual({ rated: false });
  });
});
