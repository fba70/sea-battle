import { describe, expect, it } from 'vitest';

import { LEADERBOARD_MIN_RATED_GAMES } from '../rating/policy';
import { gamesUntilRanked, winRate } from './leaderboard';

describe('winRate', () => {
  it('is the share of decided games won', () => {
    expect(winRate({ wins: 3, losses: 1 })).toBe(0.75);
  });

  it('is null with no decided games, rather than zero', () => {
    // "Has not played" and "lost everything" are different facts; printing 0% for
    // both would misreport one of them.
    expect(winRate({ wins: 0, losses: 0 })).toBeNull();
  });

  it('is zero for a player who has only lost', () => {
    expect(winRate({ wins: 0, losses: 4 })).toBe(0);
  });
});

describe('gamesUntilRanked', () => {
  it('counts down to the policy threshold', () => {
    expect(gamesUntilRanked(0)).toBe(LEADERBOARD_MIN_RATED_GAMES);
    expect(gamesUntilRanked(7)).toBe(LEADERBOARD_MIN_RATED_GAMES - 7);
  });

  it('never goes negative once the gate is open', () => {
    expect(gamesUntilRanked(LEADERBOARD_MIN_RATED_GAMES)).toBe(0);
    expect(gamesUntilRanked(LEADERBOARD_MIN_RATED_GAMES + 25)).toBe(0);
  });
});
