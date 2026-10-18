import { err, ok, type Result } from './result';
import { opponentOf, type GameState } from './state';
import type { PlayerSlot, ResultReason } from './types';

/**
 * Ending a game without sinking a fleet (spec §4, "Timers & abandonment").
 *
 * Until now the only way out of a game was `fire` sinking the last ship. Resignation,
 * running out of time and losing a connection all end a game too, and all three are
 * rules — who wins, and whether anybody does — so they belong here beside the rest of
 * the engine rather than in the transport that happens to notice them.
 *
 * Still pure and still clock-free: *when* a timer expires is the session layer's
 * business, and these functions only describe what the outcome is once it has.
 */

/** Why a game ended early. `sunk_all` is `fire`'s, and never produced here. */
export type AbandonReason = Extract<ResultReason, 'forfeit' | 'timeout' | 'disconnect'>;

export type AbandonErrorCode = 'already_finished' | 'not_your_turn' | 'wrong_phase';

export interface AbandonError {
  readonly code: AbandonErrorCode;
  readonly message: string;
}

/**
 * One player loses; the other wins.
 *
 * Legal in placement as well as play: a player who resigns or vanishes before the
 * first shot has still abandoned the game, and spec §4 treats that as a forfeit
 * rather than as nothing having happened.
 */
export function concede(
  state: GameState,
  loser: PlayerSlot,
  reason: AbandonReason,
): Result<GameState, AbandonError> {
  if (state.phase === 'finished') {
    return err({ code: 'already_finished', message: 'This game has already ended' });
  }

  return ok({
    ...state,
    phase: 'finished',
    turn: null,
    winner: opponentOf(loser),
    resultReason: reason,
  });
}

/**
 * Nobody wins.
 *
 * The case the product rule exists for: both players are gone, so there is no one to
 * award the win to. Awarding it to whichever socket happened to close second would be
 * arbitrary, and in a rated game it would hand out rating for walking away — so the
 * game ends with no winner, and the rating layer then declines to rate it because
 * there is no result to rate.
 */
export function abandon(state: GameState, reason: AbandonReason): Result<GameState, AbandonError> {
  if (state.phase === 'finished') {
    return err({ code: 'already_finished', message: 'This game has already ended' });
  }

  return ok({ ...state, phase: 'finished', turn: null, winner: null, resultReason: reason });
}

/**
 * Passes the turn without firing (spec §4: "auto-skip in Classic").
 *
 * Deliberately not a miss. A miss would mark a cell the player never chose, teaching
 * their opponent that it is empty — a real advantage handed over for being slow. The
 * turn simply moves on, and `moveCount` does not advance because no shot was resolved.
 */
export function skipTurn(state: GameState, seat: PlayerSlot): Result<GameState, AbandonError> {
  if (state.phase !== 'playing') {
    return err({ code: 'wrong_phase', message: 'Turns can only be skipped during play' });
  }
  if (state.turn !== seat) {
    return err({ code: 'not_your_turn', message: `It is not player ${seat}'s turn` });
  }

  return ok({ ...state, turn: opponentOf(seat) });
}
