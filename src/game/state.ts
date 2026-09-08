import { toIndex, type CellIndex } from './coord';
import { validateFleet, type PlacementError } from './placement';
import { err, ok, type Result } from './result';
import type { GamePhase, PlayerSlot, ResultReason, Ship, ShipPlacement } from './types';

export interface PlayerBoard {
  readonly ships: readonly Ship[];
  /** Cells the opponent has actually fired at on this board. */
  readonly shots: ReadonlySet<CellIndex>;
  /**
   * Cells revealed as known-empty without being fired at: the buffer ring auto-marked
   * when a ship here is sunk (spec §4). Kept separate from `shots` so shot counts and
   * accuracy stay honest.
   */
  readonly revealedEmpty: ReadonlySet<CellIndex>;
}

export interface GameState {
  /** Classic only for now; Salvo is Phase 2 (spec §13). */
  readonly mode: 'classic';
  readonly phase: GamePhase;
  readonly boards: Readonly<Record<PlayerSlot, PlayerBoard>>;
  /** Whose turn it is; null outside the playing phase. */
  readonly turn: PlayerSlot | null;
  readonly firstTurn: PlayerSlot;
  readonly winner: PlayerSlot | null;
  readonly resultReason: ResultReason | null;
  /** Number of shots resolved so far, for `games.move_count` (spec §6). */
  readonly moveCount: number;
}

export interface CreateGameOptions {
  /**
   * Which seat shoots first. The spec does not say how this is chosen, so the
   * caller decides; the session layer should draw it from its own seeded RNG.
   */
  readonly firstTurn?: PlayerSlot;
}

export type PlaceFleetErrorCode = 'wrong_phase' | 'already_placed';

export interface PlaceFleetError {
  readonly code: PlaceFleetErrorCode | PlacementError['code'];
  readonly message: string;
  readonly placementIndex?: number;
}

const EMPTY_BOARD: PlayerBoard = {
  ships: [],
  shots: new Set<CellIndex>(),
  revealedEmpty: new Set<CellIndex>(),
};

export function opponentOf(slot: PlayerSlot): PlayerSlot {
  return slot === 'a' ? 'b' : 'a';
}

export function createGame(options: CreateGameOptions = {}): GameState {
  const firstTurn = options.firstTurn ?? 'a';
  return {
    mode: 'classic',
    phase: 'placement',
    boards: { a: EMPTY_BOARD, b: EMPTY_BOARD },
    turn: null,
    firstTurn,
    winner: null,
    resultReason: null,
    moveCount: 0,
  };
}

/** True once every cell of the ship has been fired at. */
export function isShipSunk(ship: Ship, shots: ReadonlySet<CellIndex>): boolean {
  return ship.cells.every((cell) => shots.has(toIndex(cell)));
}

export function shipsRemaining(board: PlayerBoard): number {
  return board.ships.filter((ship) => !isShipSunk(ship, board.shots)).length;
}

export function sunkShips(board: PlayerBoard): readonly Ship[] {
  return board.ships.filter((ship) => isShipSunk(ship, board.shots));
}

export function hasPlacedFleet(board: PlayerBoard): boolean {
  return board.ships.length > 0;
}

/**
 * Validates and installs one player's fleet. When both fleets are in, the game
 * advances to the playing phase and the first turn is assigned.
 */
export function placeFleet(
  state: GameState,
  slot: PlayerSlot,
  placements: readonly ShipPlacement[],
): Result<GameState, PlaceFleetError> {
  if (state.phase !== 'placement') {
    return err({
      code: 'wrong_phase',
      message: 'Fleets can only be placed during the placement phase',
    });
  }

  if (hasPlacedFleet(state.boards[slot])) {
    return err({ code: 'already_placed', message: `Player ${slot} has already placed a fleet` });
  }

  const validated = validateFleet(placements);
  if (!validated.ok) {
    return err(validated.error);
  }

  const boards: Record<PlayerSlot, PlayerBoard> = {
    ...state.boards,
    [slot]: { ...state.boards[slot], ships: validated.value },
  };

  const bothReady = hasPlacedFleet(boards.a) && hasPlacedFleet(boards.b);

  return ok({
    ...state,
    boards,
    phase: bothReady ? 'playing' : 'placement',
    turn: bothReady ? state.firstTurn : null,
  });
}
