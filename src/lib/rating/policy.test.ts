import { describe, expect, it } from 'vitest';

import { inflateRd, MAX_RD } from '@/rating/glicko';

import {
  currentRd,
  elapsedRatingPeriods,
  GLICKO_SYSTEM_CONSTANT,
  isLeaderboardEligible,
  leaderboardEligibility,
  LEADERBOARD_INACTIVITY_DAYS,
  LEADERBOARD_MAX_RD,
  LEADERBOARD_MIN_RATED_GAMES,
  RATING_PERIOD_MS,
  type RatingActivity,
} from './policy';

const NOW = new Date('2026-10-18T09:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

function player(overrides: Partial<RatingActivity> = {}): RatingActivity {
  return { rd: 90, gamesRated: 20, lastRatingPeriodAt: daysAgo(1), ...overrides };
}

describe('the agreed product constants', () => {
  it('are the values the rating decisions were made with', () => {
    // These are product decisions, not spec values — a change here changes who is
    // ranked and how fast an absent player's rating loosens, so it should be loud.
    expect(RATING_PERIOD_MS).toBe(DAY_MS);
    expect(GLICKO_SYSTEM_CONSTANT).toBe(15);
    expect(LEADERBOARD_MIN_RATED_GAMES).toBe(10);
    expect(LEADERBOARD_MAX_RD).toBe(150);
    expect(LEADERBOARD_INACTIVITY_DAYS).toBe(30);
  });

  it('keeps c proportionate: 30 days away leaves a settled player rankable', () => {
    // The decision that makes "one match and you are back" true rather than aspirational.
    expect(currentRd({ rd: 60, lastRatingPeriodAt: daysAgo(30) }, NOW)).toBeLessThan(
      LEADERBOARD_MAX_RD,
    );
  });
});

describe('elapsedRatingPeriods', () => {
  it('counts whole days', () => {
    expect(elapsedRatingPeriods(daysAgo(30), NOW)).toBe(30);
  });

  it('is fractional, not rounded to a day boundary', () => {
    expect(elapsedRatingPeriods(daysAgo(0.5), NOW)).toBe(0.5);
    expect(elapsedRatingPeriods(new Date(NOW.getTime() - 6 * 60 * 60 * 1000), NOW)).toBe(0.25);
  });

  it('is zero for a player who has never been rated', () => {
    expect(elapsedRatingPeriods(null, NOW)).toBe(0);
  });

  it('clamps clock skew rather than running time backwards', () => {
    // The app and the database do not share a clock; a stamp a little in the future
    // must not shrink anyone's RD.
    expect(elapsedRatingPeriods(new Date(NOW.getTime() + 5_000), NOW)).toBe(0);
  });

  it('is deterministic — the same pair of instants always gives the same number', () => {
    const last = daysAgo(17.3);
    expect(elapsedRatingPeriods(last, NOW)).toBe(elapsedRatingPeriods(last, NOW));
  });
});

describe('currentRd applies spec §7.6 inactivity growth', () => {
  it('is the glicko formula with the agreed constant', () => {
    const state = player({ rd: 60, lastRatingPeriodAt: daysAgo(90) });
    expect(currentRd(state, NOW)).toBe(inflateRd(60, GLICKO_SYSTEM_CONSTANT, 90));
  });

  it('matches the simulation the c value was chosen from', () => {
    const rdAfter = (days: number) => currentRd({ rd: 60, lastRatingPeriodAt: daysAgo(days) }, NOW);

    expect(rdAfter(7)).toBeCloseTo(71.9, 1);
    expect(rdAfter(30)).toBeCloseTo(101.7, 1);
    expect(rdAfter(90)).toBeCloseTo(154.4, 1);
    expect(rdAfter(180)).toBeCloseTo(210.0, 1);
  });

  it('leaves an active player untouched', () => {
    expect(currentRd(player({ rd: 72.5, lastRatingPeriodAt: NOW }), NOW)).toBe(72.5);
  });

  it('never exceeds the Glicko maximum', () => {
    expect(currentRd(player({ rd: 349, lastRatingPeriodAt: daysAgo(10_000) }), NOW)).toBe(MAX_RD);
  });

  it('grows monotonically with time away', () => {
    const series = [0, 1, 7, 30, 90, 365].map((days) =>
      currentRd(player({ rd: 60, lastRatingPeriodAt: daysAgo(days) }), NOW),
    );
    expect(series).toEqual([...series].sort((left, right) => left - right));
  });
});

describe('leaderboard eligibility (spec §7.7)', () => {
  it('ranks a settled, active player', () => {
    expect(leaderboardEligibility(player(), NOW)).toEqual({ eligible: true });
  });

  it('excludes a player who has never been rated', () => {
    expect(
      leaderboardEligibility(player({ lastRatingPeriodAt: null, gamesRated: 0 }), NOW),
    ).toEqual({ eligible: false, reason: 'never_rated' });
  });

  describe('the minimum games gate', () => {
    it(`admits exactly ${LEADERBOARD_MIN_RATED_GAMES} rated games`, () => {
      expect(isLeaderboardEligible(player({ gamesRated: LEADERBOARD_MIN_RATED_GAMES }), NOW)).toBe(
        true,
      );
    });

    it('rejects one game short', () => {
      expect(
        leaderboardEligibility(player({ gamesRated: LEADERBOARD_MIN_RATED_GAMES - 1 }), NOW),
      ).toEqual({ eligible: false, reason: 'too_few_games' });
    });
  });

  describe('the maximum RD gate', () => {
    it('is strict: RD exactly at the threshold is excluded', () => {
      const state = player({ rd: LEADERBOARD_MAX_RD, lastRatingPeriodAt: NOW });
      expect(leaderboardEligibility(state, NOW)).toEqual({
        eligible: false,
        reason: 'rating_too_uncertain',
      });
    });

    it('admits a hair below the threshold', () => {
      expect(
        isLeaderboardEligible(
          player({ rd: LEADERBOARD_MAX_RD - 0.001, lastRatingPeriodAt: NOW }),
          NOW,
        ),
      ).toBe(true);
    });

    it('uses the inflated RD, not the stale stored one', () => {
      // The decision that stops a vanished player holding a rank on a rating that has
      // quietly gone uncertain: stored RD 149 passes, but 20 days of growth does not.
      const stale = player({ rd: 149, lastRatingPeriodAt: daysAgo(20) });

      expect(stale.rd).toBeLessThan(LEADERBOARD_MAX_RD);
      expect(currentRd(stale, NOW)).toBeGreaterThan(LEADERBOARD_MAX_RD);
      expect(leaderboardEligibility(stale, NOW)).toEqual({
        eligible: false,
        reason: 'rating_too_uncertain',
      });
    });
  });

  describe('the inactivity window', () => {
    it('keeps a player ranked on the last day of the window', () => {
      expect(
        isLeaderboardEligible(
          player({ rd: 60, lastRatingPeriodAt: daysAgo(LEADERBOARD_INACTIVITY_DAYS - 0.001) }),
          NOW,
        ),
      ).toBe(true);
    });

    it('drops them the moment the window closes', () => {
      expect(
        leaderboardEligibility(
          player({ rd: 60, lastRatingPeriodAt: daysAgo(LEADERBOARD_INACTIVITY_DAYS) }),
          NOW,
        ),
      ).toEqual({ eligible: false, reason: 'inactive' });
    });

    it('reports inactivity ahead of uncertainty, since that is the actionable one', () => {
      // A year away fails both gates; "play a match" is the useful thing to say.
      expect(
        leaderboardEligibility(player({ rd: 60, lastRatingPeriodAt: daysAgo(365) }), NOW),
      ).toEqual({ eligible: false, reason: 'inactive' });
    });

    it('reports too-few-games ahead of everything else', () => {
      expect(
        leaderboardEligibility(
          player({ gamesRated: 2, rd: 300, lastRatingPeriodAt: daysAgo(400) }),
          NOW,
        ),
      ).toEqual({ eligible: false, reason: 'too_few_games' });
    });
  });

  describe('a returning player', () => {
    const settled = { rd: 60, gamesRated: 40 };

    it('is hidden while away, with their record untouched', () => {
      const away = { ...settled, lastRatingPeriodAt: daysAgo(45) };

      expect(leaderboardEligibility(away, NOW)).toEqual({ eligible: false, reason: 'inactive' });
      // Nothing about the stored row changed — hiding is a read-time filter.
      expect(away.gamesRated).toBe(40);
      expect(away.rd).toBe(60);
    });

    it('is ranked again after one rated match, if they still qualify', () => {
      // What that match does: it stamps last_rating_period_at and writes the RD that
      // the match itself produced, which is lower than the inflated one it started from.
      const afterPlaying = { rd: 95, gamesRated: 41, lastRatingPeriodAt: NOW };
      expect(leaderboardEligibility(afterPlaying, NOW)).toEqual({ eligible: true });
    });

    it('stays excluded after returning if the single match left RD too high', () => {
      // A very long absence inflates RD to 350; one game cannot bring it under 150.
      const afterPlaying = { rd: 252.5, gamesRated: 41, lastRatingPeriodAt: NOW };
      expect(leaderboardEligibility(afterPlaying, NOW)).toEqual({
        eligible: false,
        reason: 'rating_too_uncertain',
      });
    });
  });
});
