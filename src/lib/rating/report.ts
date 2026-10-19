import type { GameMode } from '../db/schema/game';

import type { RatingStore } from './process';

/**
 * What a player is told about their rating when a match ends (spec §7.6: "show the
 * player their rating delta at game end", §9's `game_over { ratingDelta, newRating }`).
 *
 * Read back from storage rather than carried out of the calculation, for two
 * reasons. A retried result report finds the game already rated and computes
 * nothing, yet the players still deserve the number; and the same read answers a
 * player who reloads the page afterwards. The stored row is the one source.
 */

export interface SeatRating {
  /** How much this match moved the rating. Negative for a loss. */
  readonly delta: number;
  /** The rating afterwards. */
  readonly rating: number;
  /** Rated games played, for the progress towards being ranked (spec §7.7). */
  readonly gamesRated: number;
}

export type RatingReport =
  /** The match was not rated — a bot game, a private room, or a guest playing. */
  | { readonly rated: false }
  /**
   * The match was rated. A seat is absent when its rating has not landed yet, which
   * a caller should treat as "not known", never as zero.
   */
  | {
      readonly rated: true;
      readonly a: SeatRating | null;
      readonly b: SeatRating | null;
    };

export const UNRATED_REPORT: RatingReport = { rated: false };

/**
 * Builds the end-of-match rating summary for a finished game.
 *
 * Returns `rated: false` for anything that cannot move a rating, so a caller never
 * has to guess why there is no number to show.
 */
export async function loadRatingReport(store: RatingStore, gameId: string): Promise<RatingReport> {
  const game = await store.loadGame(gameId);

  if (!game || !game.rated || game.playerAId === null || game.playerBId === null) {
    return UNRATED_REPORT;
  }

  const snapshots = await store.loadRatings(
    [game.playerAId, game.playerBId],
    game.mode as GameMode,
  );

  const seat = (userId: string, delta: number | null): SeatRating | null => {
    const found = snapshots.find((snapshot) => snapshot.userId === userId);
    // Both halves must be present: a delta with no rating row, or a rating row with
    // no delta, means the result has not been applied yet.
    return found === undefined || delta === null
      ? null
      : { delta, rating: found.rating, gamesRated: found.gamesRated };
  };

  return {
    rated: true,
    a: seat(game.playerAId, game.ratingDeltaA),
    b: seat(game.playerBId, game.ratingDeltaB),
  };
}
