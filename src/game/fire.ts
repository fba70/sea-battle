import { bufferAround, fromIndex, isOnBoard, toIndex, CELL_COUNT, type CellIndex } from './coord';
import { err, ok, type Result } from './result';
import { isShipSunk, opponentOf, shipsRemaining, type GameState, type PlayerBoard } from './state';
import type { Coord, PlayerSlot, ShipClass, ShotOutcome } from './types';

export type FireErrorCode =
  'wrong_phase' | 'not_your_turn' | 'out_of_bounds' | 'already_fired' | 'already_known_empty';

export interface FireError {
  readonly code: FireErrorCode;
  readonly message: string;
}

export interface SunkShipReveal {
  readonly shipClass: ShipClass;
  /** The full outline of the sunk ship (spec §9 `ship_sunk { outline }`). */
  readonly outline: readonly Coord[];
  /** The one-cell ring auto-marked as known-empty (spec §9 `ship_sunk { bufferCells }`). */
  readonly bufferCells: readonly Coord[];
}

/** Mirrors the `fire_result` payload in spec §9. */
export interface FireEvent {
  readonly coord: Coord;
  readonly outcome: ShotOutcome;
  /** Classic rule: a hit (including a sinking hit) keeps the turn, unless the game just ended. */
  readonly extraTurn: boolean;
  readonly gameOver: boolean;
  readonly sunk?: SunkShipReveal;
}

function isKnownCell(board: PlayerBoard, index: CellIndex): boolean {
  return board.shots.has(index) || board.revealedEmpty.has(index);
}

/**
 * Resolves one Classic shot by `slot` at `coord` on the opponent's board.
 *
 * Every rejection listed in spec §9 ("reject fire when not your turn / wrong phase /
 * duplicate cell / out of bounds") is enforced here, and the returned state is a new
 * object — the engine never mutates what it was given.
 */
export function fire(
  state: GameState,
  slot: PlayerSlot,
  coord: Coord,
): Result<{ readonly state: GameState; readonly event: FireEvent }, FireError> {
  if (state.phase !== 'playing') {
    return err({
      code: 'wrong_phase',
      message: 'Shots can only be fired while the game is in play',
    });
  }

  if (state.turn !== slot) {
    return err({ code: 'not_your_turn', message: `It is not player ${slot}'s turn` });
  }

  if (!isOnBoard(coord)) {
    return err({
      code: 'out_of_bounds',
      message: `Cell ${coord.x},${coord.y} is not on the board`,
    });
  }

  const defender = opponentOf(slot);
  const board = state.boards[defender];
  const index = toIndex(coord);

  if (board.shots.has(index)) {
    return err({ code: 'already_fired', message: 'That cell has already been fired at' });
  }

  if (board.revealedEmpty.has(index)) {
    return err({
      code: 'already_known_empty',
      message: 'That cell is already known to be empty (buffer around a sunk ship)',
    });
  }

  const shots = new Set(board.shots);
  shots.add(index);

  const struck = board.ships.find((ship) => ship.cells.some((cell) => toIndex(cell) === index));

  let outcome: ShotOutcome = struck ? 'hit' : 'miss';
  const revealedEmpty = new Set(board.revealedEmpty);
  let sunk: SunkShipReveal | undefined;

  if (struck && isShipSunk(struck, shots)) {
    outcome = 'sunk';

    // Spec §4: reveal the outline and auto-mark the surrounding buffer as known-empty.
    // Cells already fired at keep their existing result rather than becoming "empty".
    const bufferCells = bufferAround(struck.cells).filter((cell) => !shots.has(toIndex(cell)));
    for (const cell of bufferCells) {
      revealedEmpty.add(toIndex(cell));
    }

    sunk = { shipClass: struck.shipClass, outline: struck.cells, bufferCells };
  }

  const nextBoard: PlayerBoard = { ...board, shots, revealedEmpty };
  const gameOver = shipsRemaining(nextBoard) === 0;
  // Classic: hit (or sink) keeps the turn, miss passes it.
  const extraTurn = outcome !== 'miss' && !gameOver;

  const nextState: GameState = {
    ...state,
    boards: { ...state.boards, [defender]: nextBoard },
    phase: gameOver ? 'finished' : 'playing',
    turn: gameOver ? null : extraTurn ? slot : defender,
    winner: gameOver ? slot : null,
    resultReason: gameOver ? 'sunk_all' : null,
    moveCount: state.moveCount + 1,
  };

  return ok({
    state: nextState,
    event: { coord, outcome, extraTurn, gameOver, ...(sunk ? { sunk } : {}) },
  });
}

/** Cells `slot` may still legally fire at. Useful for bots and for UI affordances. */
export function legalTargets(state: GameState, slot: PlayerSlot): Coord[] {
  if (state.phase !== 'playing' || state.turn !== slot) {
    return [];
  }

  const board = state.boards[opponentOf(slot)];
  const targets: Coord[] = [];

  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (!isKnownCell(board, index)) {
      targets.push(fromIndex(index));
    }
  }

  return targets;
}
