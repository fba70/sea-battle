import { autoPlaceFleet } from '../autoplace';
import { BOARD_SIZE } from '../constants';
import type { Rng } from '../rng';
import type { Coord, Ship } from '../types';

function isEdgeCell(coord: Coord): boolean {
  return coord.x === 0 || coord.y === 0 || coord.x === BOARD_SIZE - 1 || coord.y === BOARD_SIZE - 1;
}

/**
 * Lower is better. Penalises fleets that hug the edges (a very common human and
 * bot tell) and fleets whose ships bunch into one region of the board.
 */
export function placementPredictability(ships: readonly Ship[]): number {
  const cells = ships.flatMap((ship) => ship.cells);
  const edgePenalty = cells.filter(isEdgeCell).length;

  const centre = (BOARD_SIZE - 1) / 2;
  const meanX = cells.reduce((total, cell) => total + cell.x, 0) / cells.length;
  const meanY = cells.reduce((total, cell) => total + cell.y, 0) / cells.length;
  // A well-spread fleet has its centre of mass near the middle of the board.
  const clusterPenalty = (Math.abs(meanX - centre) + Math.abs(meanY - centre)) * 4;

  return edgePenalty + clusterPenalty;
}

/**
 * Samples several legal fleets and keeps the least predictable one (spec §7.3:
 * "avoid predictable patterns; optionally bias against edges/adjacency clustering").
 * Every candidate comes from `autoPlaceFleet`, so the result is always legal.
 */
export function chooseLeastPredictableFleet(rng: Rng, samples: number): readonly Ship[] {
  let best = autoPlaceFleet(rng);
  let bestScore = placementPredictability(best);

  for (let i = 1; i < samples; i += 1) {
    const candidate = autoPlaceFleet(rng);
    const score = placementPredictability(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}
