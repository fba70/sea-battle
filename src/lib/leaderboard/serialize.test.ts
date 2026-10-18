import { describe, expect, it } from 'vitest';

import type { PlayerStanding } from './leaderboard';
import { publicStanding } from './serialize';

const RANKED: PlayerStanding = {
  mode: 'classic',
  userId: 'user-a',
  name: 'Ada',
  country: 'DE',
  avatarSeed: null,
  rating: 1620.4,
  rd: 88.2,
  storedRd: 84.1,
  gamesRated: 24,
  lastRatingPeriodAt: new Date('2026-10-17T20:00:00Z'),
  wins: 15,
  losses: 9,
  eligibility: { eligible: true },
  rank: 3,
};

describe('publicStanding', () => {
  it('publishes what spec §7.7 already shows on the board', () => {
    const projected = publicStanding(RANKED, { includeActivity: false });

    expect(projected).toMatchObject({
      userId: 'user-a',
      name: 'Ada',
      country: 'DE',
      rating: 1620.4,
      rd: 88.2,
      wins: 15,
      losses: 9,
      rank: 3,
      eligible: true,
      exclusionReason: null,
    });
  });

  it('withholds the exact last-played instant from anyone but the owner', () => {
    // The public board reveals activity only as a 30-day bucket; a timestamp is finer
    // than that, so it is owner-only.
    expect(publicStanding(RANKED, { includeActivity: false })).not.toHaveProperty(
      'lastRatingPeriodAt',
    );
    expect(publicStanding(RANKED, { includeActivity: true }).lastRatingPeriodAt).toBe(
      '2026-10-17T20:00:00.000Z',
    );
  });

  it('never carries the stored RD, which would expose pre-inflation state', () => {
    expect(publicStanding(RANKED, { includeActivity: true })).not.toHaveProperty('storedRd');
  });

  it('names why an excluded player is not ranked', () => {
    const excluded = publicStanding(
      { ...RANKED, rank: null, eligibility: { eligible: false, reason: 'inactive' } },
      { includeActivity: true },
    );

    expect(excluded).toMatchObject({ eligible: false, exclusionReason: 'inactive', rank: null });
  });
});
