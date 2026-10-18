import type { PlayerStanding } from './leaderboard';

/**
 * What a standing looks like over the wire.
 *
 * A projection rather than the row itself, so adding a field to `PlayerStanding`
 * never silently publishes it.
 */
export interface SerializedStanding {
  readonly userId: string;
  readonly name: string;
  readonly country: string | null;
  readonly avatarSeed: string | null;
  readonly mode: string;
  readonly rating: number;
  /** RD as of the response, with inactivity growth applied. */
  readonly rd: number;
  readonly gamesRated: number;
  readonly wins: number;
  readonly losses: number;
  readonly rank: number | null;
  readonly eligible: boolean;
  /** Why they are not ranked; null when they are. */
  readonly exclusionReason: string | null;
  /** Owner-only: the exact instant of their last rated match. */
  readonly lastRatingPeriodAt?: string | null;
}

export function publicStanding(
  standing: PlayerStanding,
  { includeActivity }: { includeActivity: boolean },
): SerializedStanding {
  const base: SerializedStanding = {
    userId: standing.userId,
    name: standing.name,
    country: standing.country,
    avatarSeed: standing.avatarSeed,
    mode: standing.mode,
    rating: standing.rating,
    rd: standing.rd,
    gamesRated: standing.gamesRated,
    wins: standing.wins,
    losses: standing.losses,
    rank: standing.rank,
    eligible: standing.eligibility.eligible,
    exclusionReason: standing.eligibility.eligible ? null : standing.eligibility.reason,
  };

  // The exclusion reason already says "inactive"; the exact timestamp is finer-grained
  // than anything the public board reveals, so only the owner sees it.
  return includeActivity
    ? {
        ...base,
        lastRatingPeriodAt: standing.lastRatingPeriodAt?.toISOString() ?? null,
      }
    : base;
}
