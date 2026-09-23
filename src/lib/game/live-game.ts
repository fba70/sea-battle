import { decodeGameState, type EncodedGameState } from '@/game/codec';
import type { PlayerSlot } from '@/game/types';
import type { GameMode, GameType } from '@/lib/db/schema/game';
import type { RatingOutcome } from '@/lib/rating/process';

/**
 * The lifecycle of a live PvP game as far as Neon is concerned (spec §5.1, §6).
 *
 * Two moments matter, and only two: a row is created when the game is set up, and it
 * is completed when the realtime layer reports the result. Nothing is written per
 * move — the authoritative state lives in the Durable Object while the game is live,
 * and Neon holds durable data only.
 *
 * SECURITY: the result is derived from the encoded final state, which is re-decoded
 * through the Block 1 codec. Both fleets are re-validated, and the winner, move count
 * and reason come from the board rather than from a set of scalars a caller supplied.
 */

export interface CreateLiveGameInput {
  readonly mode: GameMode;
  readonly type: Exclude<GameType, 'bot'>;
  /** Spec §4: only a quick-match between two registered players is rated by default. */
  readonly rated: boolean;
  readonly playerAId: string;
  readonly playerBId: string;
}

export interface LiveGameRecord {
  readonly id: string;
  readonly playerAId: string | null;
  readonly playerBId: string | null;
  readonly status: string;
}

export interface CompleteLiveGameInput {
  readonly gameId: string;
  /** The seat the board says won — kept for clarity; `winnerId` is what is stored. */
  readonly winnerSeat: PlayerSlot;
  /** Resolved from the row's own seat columns, so it always satisfies
   *  Block 2's games_winner_is_a_player CHECK. */
  readonly winnerId: string;
  readonly resultReason: string;
  readonly moveCount: number;
  readonly state: EncodedGameState;
}

export interface LiveGameStore {
  create(input: CreateLiveGameInput): Promise<{ readonly id: string }>;
  load(gameId: string): Promise<LiveGameRecord | null>;
  /** Compare-and-set on `status = 'live'`; false when the game was already completed. */
  complete(input: CompleteLiveGameInput): Promise<{ readonly completed: boolean }>;
}

export type CompleteReason =
  'game_not_found' | 'state_invalid' | 'not_finished' | 'missing_winner' | 'seat_not_seated';

export type CompleteLiveGameOutcome =
  | {
      readonly status: 'completed' | 'already_completed';
      readonly gameId: string;
      readonly rating: RatingOutcome;
    }
  | { readonly status: 'rejected'; readonly gameId: string; readonly reason: CompleteReason };

export interface RatingProcessor {
  (gameId: string): Promise<RatingOutcome>;
}

/**
 * Creates the row a live game will be played against.
 *
 * Called before the players are given connection tickets, so the game id exists before
 * anyone connects and the Durable Object is addressed by a real, durable identifier.
 */
export async function createLiveGame(
  store: LiveGameStore,
  input: CreateLiveGameInput,
): Promise<{ readonly id: string }> {
  if (input.playerAId === input.playerBId) {
    throw new Error('A live game needs two distinct players');
  }
  if (input.type === 'private' && input.rated) {
    // Spec §4: private-room games are unrated by default; a rated toggle for two
    // registered players is a later block's decision, not a default.
    throw new Error('Rated private games are not supported yet');
  }

  return store.create(input);
}

/**
 * Records the end of a live game and then applies ratings.
 *
 * Both steps are independently idempotent, which is what makes a retried report safe:
 * `complete` is a compare-and-set on the row's status, and the Block 4 rating processor
 * claims the game by writing its still-null deltas. A second report finds the game
 * already completed, and the rating processor declines to rate it twice.
 */
export async function completeLiveGame(
  store: LiveGameStore,
  rateGame: RatingProcessor,
  report: { readonly gameId: string; readonly state: EncodedGameState },
): Promise<CompleteLiveGameOutcome> {
  const game = await store.load(report.gameId);
  if (!game) {
    return { status: 'rejected', gameId: report.gameId, reason: 'game_not_found' };
  }

  // Re-validates both fleets and every cross-field invariant. A report cannot write a
  // board the engine would refuse.
  const decoded = decodeGameState(report.state);
  if (!decoded.ok) {
    return { status: 'rejected', gameId: report.gameId, reason: 'state_invalid' };
  }

  const state = decoded.value;
  if (state.phase !== 'finished') {
    return { status: 'rejected', gameId: report.gameId, reason: 'not_finished' };
  }
  if (state.winner === null || state.resultReason === null) {
    return { status: 'rejected', gameId: report.gameId, reason: 'missing_winner' };
  }

  // The seat the game says won must map to a player this row actually seats.
  const winnerId = state.winner === 'a' ? game.playerAId : game.playerBId;
  if (winnerId === null) {
    return { status: 'rejected', gameId: report.gameId, reason: 'seat_not_seated' };
  }

  const { completed } = await store.complete({
    gameId: report.gameId,
    winnerSeat: state.winner,
    winnerId,
    resultReason: state.resultReason,
    moveCount: state.moveCount,
    state: report.state,
  });

  // Runs either way: a report may be retried after the row was completed but before
  // the rating was applied, and the processor is the thing that decides eligibility.
  const rating = await rateGame(report.gameId);

  return {
    status: completed ? 'completed' : 'already_completed',
    gameId: report.gameId,
    rating,
  };
}
