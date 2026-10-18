import { rateHeadToHead, INITIAL_RATING, type GlickoRating } from '@/rating/glicko';

import {
  decideRatingEligibility,
  type RatingSkipReason,
  type StoredGameForRating,
} from './eligibility';
import { currentRd } from './policy';
import type { GameMode } from '../db/schema/game';

/**
 * Applies Glicko-1 to a finished rated game (spec §7.6).
 *
 * The only input is a game id. Everything else — who played, who won, whether the
 * game was rated, whether either player is a guest — is read from the authoritative
 * `games` row, so nothing a client said can influence a rating.
 *
 * Exactly-once is the store's job, not this function's: `applyRatedResult` performs a
 * compare-and-set on the game's still-null rating deltas, and the rating writes are
 * conditional on that CAS inside a single statement. A retry or a concurrent call
 * therefore reads a consistent pre-match state, computes the same numbers, and then
 * loses the race harmlessly — see `rating-store.ts`.
 */

export interface RatingSnapshot extends GlickoRating {
  readonly userId: string;
  /**
   * When this rating was last recalculated. The input to RD inflation, so it has to
   * come back with the rating itself — see `preMatchRating`.
   */
  readonly lastRatingPeriodAt: Date | null;
}

export interface ApplyRatedResultInput {
  readonly gameId: string;
  readonly mode: GameMode;
  readonly ratedAt: Date;
  readonly a: { readonly userId: string; readonly next: GlickoRating; readonly delta: number };
  readonly b: { readonly userId: string; readonly next: GlickoRating; readonly delta: number };
}

export interface RatingStore {
  loadGame(gameId: string): Promise<StoredGameForRating | null>;
  /** Missing rows mean an unrated player; the caller substitutes the 1500/350 start. */
  loadRatings(userIds: readonly string[], mode: GameMode): Promise<readonly RatingSnapshot[]>;
  /** Returns false when another caller already rated this game. */
  applyRatedResult(input: ApplyRatedResultInput): Promise<{ readonly applied: boolean }>;
}

export type RatingOutcome =
  | {
      readonly status: 'applied';
      readonly gameId: string;
      readonly deltaA: number;
      readonly deltaB: number;
    }
  /** Another call got there first — the CAS matched no rows. Not an error. */
  | { readonly status: 'already_processed'; readonly gameId: string }
  | { readonly status: 'skipped'; readonly gameId: string; readonly reason: RatingSkipReason }
  | { readonly status: 'not_found'; readonly gameId: string };

/**
 * The rating a player actually enters this game with.
 *
 * Spec §7.6 recommends applying RD inflation "lazily at the next game based on
 * elapsed time", and this is that moment: nothing writes a player's grown RD while
 * they are away, so their stored RD is only correct as of their last rated match.
 * The reference instant is the game's own end time, not a clock, which is what lets a
 * replay or a retry months later reproduce the same numbers.
 *
 * An active player is unaffected in practice — zero elapsed time leaves RD untouched
 * — and a player with no rating row yet starts at spec §7.6's 1500 / RD 350, which is
 * already the maximum RD and so cannot inflate further.
 */
function preMatchRating(
  snapshots: readonly RatingSnapshot[],
  userId: string,
  ratedAt: Date,
): GlickoRating {
  const found = snapshots.find((snapshot) => snapshot.userId === userId);
  if (!found) {
    return INITIAL_RATING;
  }
  return { rating: found.rating, rd: currentRd(found, ratedAt) };
}

/**
 * Rates one finished game.
 *
 * Both players are updated from the *same* pre-match snapshot — `rateHeadToHead`
 * enforces that structurally, so seat B's new rating never sees seat A's updated one.
 *
 * Inactivity is handled first: each player's stored RD is inflated to what it is as
 * of this game's end time before any rating math runs (spec §7.6's lazy inflation).
 * `src/lib/rating/policy.ts` owns the constants that govern it — they are product
 * decisions, not spec values.
 */
export async function processFinishedGame(
  store: RatingStore,
  gameId: string,
): Promise<RatingOutcome> {
  const game = await store.loadGame(gameId);
  if (!game) {
    return { status: 'not_found', gameId };
  }

  const eligibility = decideRatingEligibility(game);
  if (!eligibility.eligible) {
    return { status: 'skipped', gameId, reason: eligibility.reason };
  }

  const snapshots = await store.loadRatings(
    [eligibility.playerAId, eligibility.playerBId],
    eligibility.mode,
  );

  const before = {
    a: preMatchRating(snapshots, eligibility.playerAId, eligibility.ratedAt),
    b: preMatchRating(snapshots, eligibility.playerBId, eligibility.ratedAt),
  };

  const rated = rateHeadToHead(before.a, before.b, eligibility.scoreForA);

  const { applied } = await store.applyRatedResult({
    gameId: eligibility.gameId,
    mode: eligibility.mode,
    ratedAt: eligibility.ratedAt,
    a: { userId: eligibility.playerAId, next: rated.a, delta: rated.deltaA },
    b: { userId: eligibility.playerBId, next: rated.b, delta: rated.deltaB },
  });

  if (!applied) {
    return { status: 'already_processed', gameId };
  }

  return { status: 'applied', gameId, deltaA: rated.deltaA, deltaB: rated.deltaB };
}
