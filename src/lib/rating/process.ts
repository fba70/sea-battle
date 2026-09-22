import { rateHeadToHead, INITIAL_RATING, type GlickoRating } from '@/rating/glicko';

import {
  decideRatingEligibility,
  type RatingSkipReason,
  type StoredGameForRating,
} from './eligibility';
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

function ratingFor(snapshots: readonly RatingSnapshot[], userId: string): GlickoRating {
  const found = snapshots.find((snapshot) => snapshot.userId === userId);
  // Spec §7.6: a player with no rating row yet starts at 1500 / RD 350.
  return found ? { rating: found.rating, rd: found.rd } : INITIAL_RATING;
}

/**
 * Rates one finished game.
 *
 * Both players are updated from the *same* pre-match snapshot — `rateHeadToHead`
 * enforces that structurally, so seat B's new rating never sees seat A's updated one.
 *
 * Note what this deliberately does not do: it applies no RD inflation for inactivity.
 * Spec §7.6 defines that as `RD ← min(sqrt(RD² + c²·t), 350)`, and leaves `c` and the
 * rating-period length to tuning. `inflateRd` exists and is tested; wiring it in is a
 * one-line change once those values are decided. Until then `last_rating_period_at` is
 * recorded so the elapsed time is recoverable.
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
    a: ratingFor(snapshots, eligibility.playerAId),
    b: ratingFor(snapshots, eligibility.playerBId),
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
