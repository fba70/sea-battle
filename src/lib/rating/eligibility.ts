import type { GameMode } from '../db/schema/game';

/**
 * Whether a finished game may move ratings (spec §4, §7.6).
 *
 * Pure: it inspects the authoritative row that was read from the database and nothing
 * else. There is no client input anywhere in this path — the caller supplies a game id
 * and every fact used here comes from the stored game.
 */

/** The subset of a `games` row this decision needs, plus both players' guest flags. */
export interface StoredGameForRating {
  readonly id: string;
  readonly mode: string;
  readonly type: string;
  readonly status: string;
  readonly rated: boolean;
  readonly playerAId: string | null;
  readonly playerBId: string | null;
  readonly winnerId: string | null;
  readonly endedAt: Date | null;
  readonly ratingDeltaA: number | null;
  readonly ratingDeltaB: number | null;
  /** Null when the seat is vacant or the account was erased (spec §11). */
  readonly playerAIsAnonymous: boolean | null;
  readonly playerBIsAnonymous: boolean | null;
}

export type RatingSkipReason =
  /** Spec §4: bot, guest and private-unrated games never touch ratings. */
  | 'not_rated'
  /** Only a finished game has a result to rate. */
  | 'not_completed'
  /** Spec §4: bot games are unrated, whatever the flag says. */
  | 'bot_game'
  /** A vacant seat, or an account erased under spec §11. */
  | 'missing_player'
  /** Spec §4: guests are unrated, and Block 2 refuses them a ratings row. */
  | 'guest_player'
  /** No result to derive a score from. */
  | 'no_winner'
  /** The stored winner is not one of the seats — a corrupt row. */
  | 'winner_not_a_player'
  /** Deltas are already stored, so this game was rated before. */
  | 'already_processed'
  /** Needed to stamp the rating period; a completed game always has one. */
  | 'missing_end_time';

export interface RatedGame {
  readonly eligible: true;
  readonly gameId: string;
  readonly mode: GameMode;
  readonly playerAId: string;
  readonly playerBId: string;
  /** 1 when seat A won, 0 when seat B did. Classic cannot draw. */
  readonly scoreForA: 1 | 0;
  /** When the game ended — used as the rating-period stamp, so this stays replayable. */
  readonly ratedAt: Date;
}

export type RatingEligibility =
  RatedGame | { readonly eligible: false; readonly reason: RatingSkipReason };

function deny(reason: RatingSkipReason): RatingEligibility {
  return { eligible: false, reason };
}

/**
 * Decides whether `game` should move ratings, and with what score.
 *
 * Every gate is a separate check with its own reason so a skipped game can be
 * explained rather than silently ignored. The guest gate matters most: Block 2 makes a
 * guest ratings row impossible at the database level, so letting a guest game through
 * here would abort the write rather than corrupt anything — but failing early gives a
 * usable reason instead of a foreign-key error.
 */
export function decideRatingEligibility(game: StoredGameForRating): RatingEligibility {
  if (!game.rated) {
    return deny('not_rated');
  }
  if (game.type === 'bot') {
    return deny('bot_game');
  }
  if (game.status !== 'completed') {
    return deny('not_completed');
  }
  if (game.ratingDeltaA !== null || game.ratingDeltaB !== null) {
    return deny('already_processed');
  }

  const { playerAId, playerBId } = game;
  if (playerAId === null || playerBId === null) {
    return deny('missing_player');
  }
  if (game.playerAIsAnonymous !== false || game.playerBIsAnonymous !== false) {
    return deny('guest_player');
  }
  if (game.winnerId === null) {
    return deny('no_winner');
  }
  if (game.winnerId !== playerAId && game.winnerId !== playerBId) {
    return deny('winner_not_a_player');
  }
  if (game.endedAt === null) {
    return deny('missing_end_time');
  }

  return {
    eligible: true,
    gameId: game.id,
    // Constrained to the mode list by Block 2's games_mode_valid CHECK.
    mode: game.mode as GameMode,
    playerAId,
    playerBId,
    scoreForA: game.winnerId === playerAId ? 1 : 0,
    ratedAt: game.endedAt,
  };
}
