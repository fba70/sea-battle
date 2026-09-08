import { BOARD_SIZE, COLUMN_LABELS } from './constants';
import type { Coord } from './types';

/** A board cell flattened to `y * BOARD_SIZE + x`, so cell sets are plain number sets. */
export type CellIndex = number;

export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

export function isInteger(value: number): boolean {
  return Number.isInteger(value);
}

export function isOnBoard(coord: Coord): boolean {
  return (
    isInteger(coord.x) &&
    isInteger(coord.y) &&
    coord.x >= 0 &&
    coord.x < BOARD_SIZE &&
    coord.y >= 0 &&
    coord.y < BOARD_SIZE
  );
}

export function toIndex(coord: Coord): CellIndex {
  return coord.y * BOARD_SIZE + coord.x;
}

export function fromIndex(index: CellIndex): Coord {
  return { x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE) };
}

export function coordsEqual(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Display notation from spec §4: columns A-J, rows 1-10. `{x:0,y:0}` -> "A1". */
export function formatCoord(coord: Coord): string {
  const column = COLUMN_LABELS[coord.x];
  if (column === undefined) {
    throw new RangeError(`Coordinate out of board: ${coord.x},${coord.y}`);
  }
  return `${column}${coord.y + 1}`;
}

export function parseCoord(label: string): Coord | null {
  const match = /^([A-Ja-j])(10|[1-9])$/.exec(label.trim());
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { x: match[1].toUpperCase().charCodeAt(0) - 65, y: Number(match[2]) - 1 };
}

/** The up-to-8 on-board cells surrounding `coord`, diagonals included. */
export function neighbours(coord: Coord): Coord[] {
  const result: Coord[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const candidate = { x: coord.x + dx, y: coord.y + dy };
      if (isOnBoard(candidate)) {
        result.push(candidate);
      }
    }
  }
  return result;
}

/**
 * The one-cell "buffer" ring around a group of cells (spec §4), clipped to the
 * board and excluding the group itself. Used both for the no-touching rule and
 * for the known-empty cells revealed when a ship is sunk.
 */
export function bufferAround(cells: readonly Coord[]): Coord[] {
  const own = new Set(cells.map(toIndex));
  const buffer = new Set<CellIndex>();

  for (const cell of cells) {
    for (const neighbour of neighbours(cell)) {
      const index = toIndex(neighbour);
      if (!own.has(index)) {
        buffer.add(index);
      }
    }
  }

  return [...buffer].sort((a, b) => a - b).map(fromIndex);
}
