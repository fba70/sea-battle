import { BOARD_SIZE } from './constants';
import { fromIndex, isOnBoard, toIndex } from './coord';
import { isShipSunk, opponentOf, shipsRemaining, type GameState, type PlayerBoard } from './state';
import type { Coord, GamePhase, PlayerSlot, ResultReason, Ship, ShipClass } from './types';

/** What the viewer knows about a cell on their own board. */
export type OwnCellState = 'empty' | 'ship' | 'miss' | 'hit' | 'sunk';

/** What the viewer is *allowed* to know about a cell on someone else's board. */
export type OpponentCellState = 'unknown' | 'miss' | 'hit' | 'sunk' | 'known_empty';

export interface SunkShipView {
  readonly shipClass: ShipClass;
  readonly cells: readonly Coord[];
}

export interface OwnBoardView {
  /** Your own fleet, in full — it is yours to see. */
  readonly ships: readonly Ship[];
  readonly grid: readonly (readonly OwnCellState[])[];
  readonly shipsRemaining: number;
  readonly shipsSunk: number;
  readonly incomingShots: number;
}

export interface OpponentBoardView {
  readonly grid: readonly (readonly OpponentCellState[])[];
  /** Derivable from the sunk count, so this reveals nothing extra. */
  readonly shipsRemaining: number;
  readonly sunkShips: readonly SunkShipView[];
  readonly shotsFired: number;
  readonly hits: number;
}

export interface PlayerView {
  readonly viewer: PlayerSlot;
  readonly mode: 'classic';
  readonly phase: GamePhase;
  readonly turn: PlayerSlot | null;
  readonly isYourTurn: boolean;
  readonly winner: PlayerSlot | null;
  readonly resultReason: ResultReason | null;
  readonly moveCount: number;
  readonly own: OwnBoardView;
  readonly opponent: OpponentBoardView;
}

export interface PublicBoardView {
  readonly grid: readonly (readonly OpponentCellState[])[];
  readonly shipsRemaining: number;
  readonly sunkShips: readonly SunkShipView[];
}

export interface PublicView {
  readonly mode: 'classic';
  readonly phase: GamePhase;
  readonly turn: PlayerSlot | null;
  readonly winner: PlayerSlot | null;
  readonly resultReason: ResultReason | null;
  readonly moveCount: number;
  readonly boards: Readonly<Record<PlayerSlot, PublicBoardView>>;
}

function emptyGrid<T>(fill: T): T[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => fill));
}

function setCell<T>(grid: T[][], coord: Coord, value: T): void {
  const row = grid[coord.y];
  if (row) {
    row[coord.x] = value;
  }
}

function sunkShipViews(board: PlayerBoard): SunkShipView[] {
  return board.ships
    .filter((ship) => isShipSunk(ship, board.shots))
    .map((ship) => ({ shipClass: ship.shipClass, cells: ship.cells }));
}

/**
 * Builds the opponent-facing grid for `board`.
 *
 * This is THE hidden-information boundary (spec §5.1, §10). It starts from an
 * all-`unknown` grid and writes only cells the viewer has legitimately learned:
 * cells they fired at, and the buffer auto-revealed when a ship sank. Ship
 * positions are consulted solely to classify a cell that was *already* fired at,
 * so an un-fired ship cell is indistinguishable from open water.
 */
function opponentGrid(board: PlayerBoard): OpponentCellState[][] {
  const grid = emptyGrid<OpponentCellState>('unknown');
  const shipCellToShip = new Map<number, Ship>();

  for (const ship of board.ships) {
    for (const cell of ship.cells) {
      shipCellToShip.set(toIndex(cell), ship);
    }
  }

  for (const index of board.shots) {
    const coord = fromIndex(index);
    const ship = shipCellToShip.get(index);

    if (!ship) {
      setCell(grid, coord, 'miss');
    } else {
      setCell(grid, coord, isShipSunk(ship, board.shots) ? 'sunk' : 'hit');
    }
  }

  for (const index of board.revealedEmpty) {
    setCell(grid, fromIndex(index), 'known_empty');
  }

  return grid;
}

function ownGrid(board: PlayerBoard): OwnCellState[][] {
  const grid = emptyGrid<OwnCellState>('empty');

  for (const ship of board.ships) {
    const sunk = isShipSunk(ship, board.shots);
    for (const cell of ship.cells) {
      setCell(grid, cell, sunk ? 'sunk' : board.shots.has(toIndex(cell)) ? 'hit' : 'ship');
    }
  }

  for (const index of board.shots) {
    const coord = fromIndex(index);
    const row = grid[coord.y];
    if (row && row[coord.x] === 'empty') {
      row[coord.x] = 'miss';
    }
  }

  return grid;
}

function countHits(board: PlayerBoard): number {
  const shipCells = new Set(board.ships.flatMap((ship) => ship.cells.map(toIndex)));
  let hits = 0;
  for (const index of board.shots) {
    if (shipCells.has(index)) {
      hits += 1;
    }
  }
  return hits;
}

/**
 * The only representation of a game that may be sent to a player.
 *
 * Never serialise `GameState` itself to a client: it contains both fleets.
 */
export function createPlayerView(state: GameState, viewer: PlayerSlot): PlayerView {
  const ownBoard = state.boards[viewer];
  const opponentBoard = state.boards[opponentOf(viewer)];

  return {
    viewer,
    mode: state.mode,
    phase: state.phase,
    turn: state.turn,
    isYourTurn: state.turn === viewer,
    winner: state.winner,
    resultReason: state.resultReason,
    moveCount: state.moveCount,
    own: {
      ships: ownBoard.ships,
      grid: ownGrid(ownBoard),
      shipsRemaining: shipsRemaining(ownBoard),
      shipsSunk: ownBoard.ships.length - shipsRemaining(ownBoard),
      incomingShots: ownBoard.shots.size,
    },
    opponent: {
      grid: opponentGrid(opponentBoard),
      shipsRemaining: shipsRemaining(opponentBoard),
      sunkShips: sunkShipViews(opponentBoard),
      shotsFired: opponentBoard.shots.size,
      hits: countHits(opponentBoard),
    },
  };
}

/**
 * A view safe for anyone who is not a participant: neither fleet is revealed,
 * only what both players have already learned about each other.
 */
export function createPublicView(state: GameState): PublicView {
  const boardView = (slot: PlayerSlot): PublicBoardView => {
    const board = state.boards[slot];
    return {
      grid: opponentGrid(board),
      shipsRemaining: shipsRemaining(board),
      sunkShips: sunkShipViews(board),
    };
  };

  return {
    mode: state.mode,
    phase: state.phase,
    turn: state.turn,
    winner: state.winner,
    resultReason: state.resultReason,
    moveCount: state.moveCount,
    boards: { a: boardView('a'), b: boardView('b') },
  };
}

export function ownCellAt(view: PlayerView, coord: Coord): OwnCellState {
  if (!isOnBoard(coord)) {
    throw new RangeError(`Coordinate off board: ${coord.x},${coord.y}`);
  }
  return view.own.grid[coord.y]?.[coord.x] ?? 'empty';
}

export function opponentCellAt(view: PlayerView, coord: Coord): OpponentCellState {
  if (!isOnBoard(coord)) {
    throw new RangeError(`Coordinate off board: ${coord.x},${coord.y}`);
  }
  return view.opponent.grid[coord.y]?.[coord.x] ?? 'unknown';
}
