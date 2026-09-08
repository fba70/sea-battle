import { describe, expect, it } from 'vitest';

import { autoPlaceFleet } from './autoplace';
import { FLEET_CELL_COUNT, FLEET_SHIP_COUNT } from './constants';
import { bufferAround, toIndex } from './coord';
import { validateFleet } from './placement';
import { createRng } from './rng';
import type { Ship } from './types';

function asPlacements(ships: readonly Ship[]) {
  return ships.map(({ shipClass, origin, orientation }) => ({ shipClass, origin, orientation }));
}

describe('autoPlaceFleet', () => {
  it('always produces a fleet the validator accepts (500 seeds)', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const ships = autoPlaceFleet(createRng(seed));
      const result = validateFleet(asPlacements(ships));

      if (!result.ok) {
        throw new Error(`seed ${seed} produced an illegal fleet: ${result.error.code}`);
      }
    }
  });

  it('places the exact fleet composition', () => {
    const ships = autoPlaceFleet(createRng(42));

    expect(ships).toHaveLength(FLEET_SHIP_COUNT);
    expect(ships.flatMap((ship) => ship.cells)).toHaveLength(FLEET_CELL_COUNT);
  });

  it('never lets two ships touch, across many seeds', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const ships = autoPlaceFleet(createRng(seed));

      for (const ship of ships) {
        const others = ships.filter((candidate) => candidate.id !== ship.id);
        const otherCells = new Set(others.flatMap((other) => other.cells.map(toIndex)));

        for (const cell of ship.cells) {
          expect(otherCells.has(toIndex(cell))).toBe(false);
        }
        for (const bufferCell of bufferAround(ship.cells)) {
          expect(otherCells.has(toIndex(bufferCell))).toBe(false);
        }
      }
    }
  });

  it('is deterministic for a given seed', () => {
    expect(autoPlaceFleet(createRng(2026))).toEqual(autoPlaceFleet(createRng(2026)));
  });

  it('produces different layouts for different seeds', () => {
    const layouts = new Set(
      Array.from({ length: 50 }, (_, seed) => JSON.stringify(autoPlaceFleet(createRng(seed)))),
    );

    // Not a strict guarantee, but 50 seeds collapsing to a handful would mean the
    // generator is barely random.
    expect(layouts.size).toBeGreaterThan(40);
  });

  it('gives up loudly rather than looping forever', () => {
    expect(() => autoPlaceFleet(createRng(1), 0)).toThrow(/failed to produce a legal fleet/);
  });
});
