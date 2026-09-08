import { BOARD_SIZE, FLEET } from '../constants';
import { isOnBoard, neighbours, toIndex } from '../coord';
import type { Coord, Orientation, ShipClass } from '../types';
import { cellsWithState, type OpponentCellState, type PlayerView } from '../view';

/**
 * Everything a bot may reason from, derived exclusively from the `PlayerView`.
 *
 * Nothing here consults a `GameState`; every field is something the human player
 * looking at the same screen also knows.
 */
export interface BotKnowledge {
  /** Cells not yet fired at and not auto-revealed as empty. */
  readonly targets: readonly Coord[];
  /** Hits belonging to ships that are damaged but not yet sunk. */
  readonly unresolvedHits: readonly Coord[];
  /** Sizes of the opponent ships still afloat, largest first. */
  readonly remainingShipSizes: readonly number[];
  cellState(coord: Coord): OpponentCellState;
}

const ORIENTATIONS: readonly Orientation[] = ['horizontal', 'vertical'];

const SHIP_SIZE_BY_CLASS = new Map<ShipClass, number>(
  FLEET.map((entry) => [entry.shipClass, entry.size]),
);

export function readKnowledge(view: PlayerView): BotKnowledge {
  const cellState = (coord: Coord): OpponentCellState =>
    isOnBoard(coord) ? (view.opponent.grid[coord.y]?.[coord.x] ?? 'unknown') : 'miss';

  return {
    targets: cellsWithState(view, 'unknown'),
    unresolvedHits: cellsWithState(view, 'hit'),
    remainingShipSizes: remainingShipSizes(view),
    cellState,
  };
}

/**
 * Which ships are still afloat, worked out from the sunk list — the same
 * deduction a human makes ("I've sunk the 4 and one 3, so those are left").
 */
export function remainingShipSizes(view: PlayerView): number[] {
  const remaining = new Map<ShipClass, number>(
    FLEET.map((entry) => [entry.shipClass, entry.count]),
  );

  for (const sunk of view.opponent.sunkShips) {
    const left = remaining.get(sunk.shipClass) ?? 0;
    remaining.set(sunk.shipClass, Math.max(0, left - 1));
  }

  const sizes: number[] = [];
  for (const [shipClass, count] of remaining) {
    const size = SHIP_SIZE_BY_CLASS.get(shipClass) ?? 0;
    for (let i = 0; i < count; i += 1) {
      sizes.push(size);
    }
  }

  return sizes.sort((a, b) => b - a);
}

export function placementCells(origin: Coord, size: number, orientation: Orientation): Coord[] {
  return Array.from({ length: size }, (_, offset) =>
    orientation === 'horizontal'
      ? { x: origin.x + offset, y: origin.y }
      : { x: origin.x, y: origin.y + offset },
  );
}

/**
 * Enumerates every placement of a ship of `size` that is consistent with what the
 * bot can see. A placement is possible only when:
 *
 * 1. it lies fully on the board;
 * 2. every cell it covers is still `unknown` or an already-known `hit` — a miss,
 *    a sunk cell or a known-empty buffer cell rules it out; and
 * 3. it does not touch a hit it does not itself cover.
 *
 * Rule 3 is the one that makes this ruleset tractable. Ships may not touch, not
 * even diagonally (spec §4), so a cell neighbouring a live hit cannot belong to
 * any *other* ship. That single deduction prunes a large share of the candidate
 * space — for example every diagonal neighbour of a hit is provably water, and a
 * confirmed two-cell line proves its whole flank is water.
 */
export function consistentPlacements(
  knowledge: BotKnowledge,
  size: number,
): { cells: Coord[]; hitsCovered: number }[] {
  const results: { cells: Coord[]; hitsCovered: number }[] = [];
  const orientations = size === 1 ? ORIENTATIONS.slice(0, 1) : ORIENTATIONS;
  const hitIndices = new Set(knowledge.unresolvedHits.map(toIndex));

  for (const orientation of orientations) {
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const cells = placementCells({ x, y }, size, orientation);
        if (cells.some((cell) => !isOnBoard(cell))) {
          continue;
        }

        let hitsCovered = 0;
        let possible = true;

        for (const cell of cells) {
          const state = knowledge.cellState(cell);
          if (state === 'hit') {
            hitsCovered += 1;
          } else if (state !== 'unknown') {
            possible = false;
            break;
          }
        }

        if (!possible) {
          continue;
        }

        const covered = new Set(cells.map(toIndex));
        for (const cell of cells) {
          for (const neighbour of neighbours(cell)) {
            const index = toIndex(neighbour);
            if (hitIndices.has(index) && !covered.has(index)) {
              possible = false;
              break;
            }
          }
          if (!possible) {
            break;
          }
        }

        if (possible) {
          results.push({ cells, hitsCovered });
        }
      }
    }
  }

  return results;
}

/** Deterministically picks the highest-scoring cell, breaking ties with the RNG. */
export function bestScoringCell(
  scores: ReadonlyMap<number, number>,
  candidates: readonly Coord[],
  pick: (options: readonly Coord[]) => Coord,
): Coord | null {
  let best = Number.NEGATIVE_INFINITY;
  let bestCells: Coord[] = [];

  for (const coord of candidates) {
    const score = scores.get(toIndex(coord)) ?? 0;
    if (score > best) {
      best = score;
      bestCells = [coord];
    } else if (score === best) {
      bestCells.push(coord);
    }
  }

  if (bestCells.length === 0 || best <= 0) {
    return null;
  }

  return pick(bestCells);
}
