import { describe, expect, it } from 'vitest';

import { BOARD_SIZE, COLUMN_LABELS, FLEET, FLEET_CELL_COUNT, FLEET_SHIP_COUNT } from './constants';

describe('fleet composition (spec §4)', () => {
  it('fields 10 ships totalling 20 cells', () => {
    expect(FLEET_SHIP_COUNT).toBe(10);
    expect(FLEET_CELL_COUNT).toBe(20);
  });

  it('matches the Russian ruleset: 1x4, 2x3, 3x2, 4x1', () => {
    expect(FLEET).toEqual([
      { shipClass: 'battleship', size: 4, count: 1 },
      { shipClass: 'cruiser', size: 3, count: 2 },
      { shipClass: 'destroyer', size: 2, count: 3 },
      { shipClass: 'submarine', size: 1, count: 4 },
    ]);
  });

  it('never fields a ship longer than the board', () => {
    for (const entry of FLEET) {
      expect(entry.size).toBeLessThanOrEqual(BOARD_SIZE);
    }
  });
});

describe('board geometry', () => {
  it('is 10x10 with columns A-J', () => {
    expect(BOARD_SIZE).toBe(10);
    expect(COLUMN_LABELS).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  });
});
