import { describe, expect, it } from 'vitest';

import { FLEET_CELL_COUNT, FLEET_SHIP_COUNT } from './constants';
import { toIndex } from './coord';
import { cellsOfPlacement, validateFleet } from './placement';
import { FLEET_A } from './testing/fixtures';
import type { ShipPlacement } from './types';

function withoutFirst(placements: readonly ShipPlacement[]): ShipPlacement[] {
  return placements.slice(1);
}

function replaceFirst(
  placements: readonly ShipPlacement[],
  replacement: ShipPlacement,
): ShipPlacement[] {
  return [replacement, ...placements.slice(1)];
}

describe('cellsOfPlacement', () => {
  it('lays a horizontal ship out along x', () => {
    expect(
      cellsOfPlacement({ shipClass: 'cruiser', origin: { x: 2, y: 4 }, orientation: 'horizontal' }),
    ).toEqual([
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ]);
  });

  it('lays a vertical ship out along y', () => {
    expect(
      cellsOfPlacement({ shipClass: 'cruiser', origin: { x: 2, y: 4 }, orientation: 'vertical' }),
    ).toEqual([
      { x: 2, y: 4 },
      { x: 2, y: 5 },
      { x: 2, y: 6 },
    ]);
  });
});

describe('a legal fleet', () => {
  it('is accepted and resolved into ships', () => {
    const result = validateFleet(FLEET_A);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(FLEET_SHIP_COUNT);
    expect(result.value.flatMap((ship) => ship.cells)).toHaveLength(FLEET_CELL_COUNT);
  });

  it('gives every ship a unique id and occupies 20 distinct cells', () => {
    const result = validateFleet(FLEET_A);
    if (!result.ok) throw new Error('fixture fleet must be legal');

    expect(new Set(result.value.map((ship) => ship.id)).size).toBe(FLEET_SHIP_COUNT);
    expect(new Set(result.value.flatMap((ship) => ship.cells.map(toIndex))).size).toBe(
      FLEET_CELL_COUNT,
    );
  });

  it('canonicalises the orientation of single-cell ships', () => {
    const vertical = FLEET_A.map((placement) =>
      placement.shipClass === 'submarine'
        ? { ...placement, orientation: 'vertical' as const }
        : placement,
    );
    const result = validateFleet(vertical);
    if (!result.ok) throw new Error('rotating a 1-cell ship must stay legal');

    for (const ship of result.value.filter((candidate) => candidate.size === 1)) {
      expect(ship.orientation).toBe('horizontal');
    }
  });
});

describe('bounds', () => {
  it('rejects a ship running off the right edge', () => {
    const result = validateFleet(
      replaceFirst(FLEET_A, {
        shipClass: 'battleship',
        origin: { x: 7, y: 0 },
        orientation: 'horizontal',
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('out_of_bounds');
  });

  it('rejects a ship running off the bottom edge', () => {
    const result = validateFleet(
      replaceFirst(FLEET_A, {
        shipClass: 'battleship',
        origin: { x: 0, y: 7 },
        orientation: 'vertical',
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('out_of_bounds');
  });

  it('rejects a negative origin', () => {
    const result = validateFleet(
      replaceFirst(FLEET_A, {
        shipClass: 'battleship',
        origin: { x: -1, y: 0 },
        orientation: 'horizontal',
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('out_of_bounds');
  });

  it('rejects a non-integer origin', () => {
    const result = validateFleet(
      replaceFirst(FLEET_A, {
        shipClass: 'battleship',
        origin: { x: 1.5, y: 0 },
        orientation: 'horizontal',
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_coordinate');
  });
});

describe('fleet composition', () => {
  it('rejects a fleet that is missing a ship', () => {
    const result = validateFleet(withoutFirst(FLEET_A));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_fleet_composition');
  });

  it('rejects a fleet with an extra ship', () => {
    const result = validateFleet([
      ...FLEET_A,
      { shipClass: 'submarine', origin: { x: 9, y: 9 }, orientation: 'horizontal' },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_fleet_composition');
  });

  it('rejects an empty fleet', () => {
    const result = validateFleet([]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_fleet_composition');
  });

  it('rejects an unknown ship class', () => {
    const result = validateFleet(
      replaceFirst(FLEET_A, {
        shipClass: 'carrier' as never,
        origin: { x: 0, y: 0 },
        orientation: 'horizontal',
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_ship_class');
  });

  it('rejects a non-orthogonal orientation', () => {
    const result = validateFleet(
      replaceFirst(FLEET_A, {
        shipClass: 'battleship',
        origin: { x: 0, y: 0 },
        orientation: 'diagonal' as never,
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_orientation');
  });
});

describe('overlap and the no-touching rule (spec §4)', () => {
  it('rejects two ships sharing a cell', () => {
    const result = validateFleet([
      { shipClass: 'battleship', origin: { x: 0, y: 0 }, orientation: 'horizontal' },
      { shipClass: 'cruiser', origin: { x: 2, y: 0 }, orientation: 'horizontal' },
      ...FLEET_A.slice(2),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ships_overlap');
  });

  it('rejects ships touching side by side', () => {
    const result = validateFleet([
      { shipClass: 'battleship', origin: { x: 0, y: 0 }, orientation: 'horizontal' },
      { shipClass: 'cruiser', origin: { x: 4, y: 0 }, orientation: 'horizontal' },
      ...FLEET_A.slice(2),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ships_touch');
  });

  it('rejects ships touching only at a diagonal corner', () => {
    const result = validateFleet([
      { shipClass: 'battleship', origin: { x: 0, y: 0 }, orientation: 'horizontal' },
      // Starts diagonally adjacent to the battleship's last cell (D1 -> E2).
      { shipClass: 'cruiser', origin: { x: 4, y: 1 }, orientation: 'horizontal' },
      ...FLEET_A.slice(2),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ships_touch');
  });

  it('accepts ships separated by exactly one cell', () => {
    const result = validateFleet([
      { shipClass: 'battleship', origin: { x: 0, y: 0 }, orientation: 'horizontal' },
      // One clear column between D1 and F1.
      { shipClass: 'cruiser', origin: { x: 5, y: 0 }, orientation: 'horizontal' },
      ...FLEET_A.slice(2),
    ]);

    expect(result.ok).toBe(true);
  });

  it('reports which ship and cell caused the collision', () => {
    const result = validateFleet([
      { shipClass: 'battleship', origin: { x: 0, y: 0 }, orientation: 'horizontal' },
      { shipClass: 'cruiser', origin: { x: 4, y: 0 }, orientation: 'horizontal' },
      ...FLEET_A.slice(2),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.placementIndex).toBe(1);
    expect(result.error.coord).toEqual({ x: 4, y: 0 });
  });
});
