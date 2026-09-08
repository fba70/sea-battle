import { describe, expect, it } from 'vitest';

import {
  bufferAround,
  formatCoord,
  fromIndex,
  isOnBoard,
  neighbours,
  parseCoord,
  toIndex,
} from './coord';

describe('board bounds', () => {
  it('accepts every cell of the 10x10 board', () => {
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        expect(isOnBoard({ x, y })).toBe(true);
      }
    }
  });

  it.each([
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
    { x: 1.5, y: 0 },
    { x: Number.NaN, y: 0 },
    { x: Number.POSITIVE_INFINITY, y: 0 },
  ])('rejects off-board or non-integer coordinate %j', (coord) => {
    expect(isOnBoard(coord)).toBe(false);
  });
});

describe('index round-trip', () => {
  it('maps every cell to a unique index and back', () => {
    const seen = new Set<number>();
    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        const index = toIndex({ x, y });
        expect(seen.has(index)).toBe(false);
        seen.add(index);
        expect(fromIndex(index)).toEqual({ x, y });
      }
    }
    expect(seen.size).toBe(100);
  });
});

describe('display notation', () => {
  it.each([
    [{ x: 0, y: 0 }, 'A1'],
    [{ x: 9, y: 9 }, 'J10'],
    [{ x: 4, y: 2 }, 'E3'],
  ])('formats %j as %s', (coord, label) => {
    expect(formatCoord(coord)).toBe(label);
  });

  it('parses labels back, case-insensitively', () => {
    expect(parseCoord('A1')).toEqual({ x: 0, y: 0 });
    expect(parseCoord('j10')).toEqual({ x: 9, y: 9 });
    expect(parseCoord(' E3 ')).toEqual({ x: 4, y: 2 });
  });

  it.each(['', 'K1', 'A0', 'A11', 'AA1', '1A'])('rejects malformed label %s', (label) => {
    expect(parseCoord(label)).toBeNull();
  });
});

describe('neighbours', () => {
  it('returns all 8 surrounding cells in the middle of the board', () => {
    expect(neighbours({ x: 5, y: 5 })).toHaveLength(8);
  });

  it('clips at corners and edges', () => {
    expect(neighbours({ x: 0, y: 0 })).toHaveLength(3);
    expect(neighbours({ x: 9, y: 9 })).toHaveLength(3);
    expect(neighbours({ x: 0, y: 5 })).toHaveLength(5);
  });
});

describe('bufferAround', () => {
  it('rings a single cell with 8 cells and excludes the cell itself', () => {
    const buffer = bufferAround([{ x: 5, y: 5 }]);

    expect(buffer).toHaveLength(8);
    expect(buffer).not.toContainEqual({ x: 5, y: 5 });
  });

  it('excludes every cell of a multi-cell ship', () => {
    const ship = [
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 5, y: 3 },
    ];
    const buffer = bufferAround(ship);

    for (const cell of ship) {
      expect(buffer).not.toContainEqual(cell);
    }
    // Three-wide ship in open water: 3 above + 3 below + 2 ends + 4 diagonals = 12.
    expect(buffer).toHaveLength(12);
  });

  it('clips to the board in a corner', () => {
    expect(bufferAround([{ x: 0, y: 0 }])).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });
});
