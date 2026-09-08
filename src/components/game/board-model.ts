import { BOARD_SIZE, COLUMN_LABELS } from '@/game/constants';
import type { Coord } from '@/game/types';
import type { OpponentCellState, OwnCellState, PlayerView } from '@/game/view';

/**
 * What a single cell should draw. Deliberately a small closed set: the render
 * layer knows about marks, never about ships it has not been shown.
 */
export type CellMark = 'water' | 'ship' | 'hit' | 'sunk' | 'miss' | 'known-empty';

export interface ShipOutline {
  readonly id: string;
  readonly cells: readonly Coord[];
  readonly sunk: boolean;
}

const OWN_MARKS: Record<OwnCellState, CellMark> = {
  empty: 'water',
  ship: 'ship',
  hit: 'hit',
  sunk: 'sunk',
  miss: 'miss',
};

const OPPONENT_MARKS: Record<OpponentCellState, CellMark> = {
  unknown: 'water',
  hit: 'hit',
  sunk: 'sunk',
  miss: 'miss',
  known_empty: 'known-empty',
};

export function ownMarks(view: PlayerView): CellMark[][] {
  return view.own.grid.map((row) => row.map((state) => OWN_MARKS[state]));
}

export function opponentMarks(view: PlayerView): CellMark[][] {
  return view.opponent.grid.map((row) => row.map((state) => OPPONENT_MARKS[state]));
}

/** Your own fleet, which you are entitled to see in full. */
export function ownOutlines(view: PlayerView): ShipOutline[] {
  return view.own.ships.map((ship) => ({
    id: ship.id,
    cells: ship.cells,
    sunk: ship.cells.every((cell) => view.own.grid[cell.y]?.[cell.x] === 'sunk'),
  }));
}

/**
 * Opponent outlines come only from `view.opponent.sunkShips`, which the engine
 * populates for sunk ships alone — an un-sunk ship has no outline to draw.
 */
export function opponentOutlines(view: PlayerView): ShipOutline[] {
  return view.opponent.sunkShips.map((ship, index) => ({
    id: `${ship.shipClass}-${index}`,
    cells: ship.cells,
    sunk: true,
  }));
}

export function markAt(marks: readonly (readonly CellMark[])[], coord: Coord): CellMark {
  return marks[coord.y]?.[coord.x] ?? 'water';
}

export function coordLabel(coord: Coord): string {
  return `${COLUMN_LABELS[coord.x] ?? '?'}${coord.y + 1}`;
}

export function allCoords(): Coord[] {
  const coords: Coord[] = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      coords.push({ x, y });
    }
  }
  return coords;
}

export function clampToBoard(coord: Coord): Coord {
  return {
    x: Math.min(BOARD_SIZE - 1, Math.max(0, coord.x)),
    y: Math.min(BOARD_SIZE - 1, Math.max(0, coord.y)),
  };
}
