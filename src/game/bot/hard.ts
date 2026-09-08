import { toIndex } from '../coord';
import type { Rng } from '../rng';
import type { Coord, Ship } from '../types';
import { legalTargetsFromView, type PlayerView } from '../view';
import {
  bestScoringCell,
  consistentPlacements,
  readKnowledge,
  type BotKnowledge,
} from './knowledge';
import { chooseLeastPredictableFleet } from './placement';
import type { BotStrategy } from './types';

/**
 * Weight applied per already-known hit that a candidate placement covers.
 *
 * Spec §7.3: "In target mode, heavily weight cells extending known hit lines."
 * The multiplier is large enough that any placement explaining a live hit
 * outranks every placement that explains none, which is what makes the bot
 * finish a wounded ship instead of wandering off.
 */
const HIT_WEIGHT = 1000;

/**
 * Computes, for every still-unknown cell, how many consistent placements of the
 * opponent's *remaining* ships would cover it — the classic probability-density
 * approach from spec §7.3.
 *
 * Everything it reads comes from `BotKnowledge`, which is derived from the
 * `PlayerView` alone.
 */
export function densityScores(knowledge: BotKnowledge): Map<number, number> {
  const scores = new Map<number, number>();

  for (const size of knowledge.remainingShipSizes) {
    for (const placement of consistentPlacements(knowledge, size)) {
      const weight = 1 + placement.hitsCovered * HIT_WEIGHT;

      for (const cell of placement.cells) {
        // Already-hit cells cannot be fired at again; only score open water.
        if (knowledge.cellState(cell) !== 'unknown') {
          continue;
        }
        const index = toIndex(cell);
        scores.set(index, (scores.get(index) ?? 0) + weight);
      }
    }
  }

  return scores;
}

/**
 * The coarsest lattice that is still guaranteed to touch every ship left afloat.
 *
 * A straight ship of length k covers k consecutive values of `x + y`, so it must
 * cover at least one cell where `(x + y) % k === 0`. Searching that lattice finds
 * it while firing only 1/k of the board. The spacing is therefore the *smallest*
 * ship still afloat that is longer than one cell — anything coarser could slip
 * past the shortest survivor.
 *
 * Single-cell submarines sit outside this logic entirely: they can hide anywhere,
 * so once they are all that remains the lattice is dropped.
 */
export function huntSpacing(knowledge: BotKnowledge): number {
  const multiCellSizes = knowledge.remainingShipSizes.filter((size) => size >= 2);
  return multiCellSizes.length === 0 ? 1 : Math.min(...multiCellSizes);
}

/**
 * Narrows the hunt to that lattice. Density then ranks the cells *within* it, so
 * the bot gets the coverage guarantee of a parity search and the cell-by-cell
 * discrimination of probability density at the same time.
 *
 * Target mode is left untouched: once a ship is wounded, finishing it beats
 * starting a new search.
 */
export function huntCandidates(
  knowledge: BotKnowledge,
  targets: readonly Coord[],
): readonly Coord[] {
  if (knowledge.unresolvedHits.length > 0) {
    return targets;
  }

  const spacing = huntSpacing(knowledge);
  if (spacing <= 1) {
    return targets;
  }

  const lattice = targets.filter((coord) => (coord.x + coord.y) % spacing === 0);
  return lattice.length > 0 ? lattice : targets;
}

export const hardBot: BotStrategy = {
  difficulty: 'hard',

  chooseShot(view: PlayerView, rng: Rng): Coord {
    const targets = legalTargetsFromView(view);
    if (targets.length === 0) {
      throw new Error('Hard bot has no legal target left');
    }

    const knowledge = readKnowledge(view);
    const scores = densityScores(knowledge);
    const best = bestScoringCell(scores, huntCandidates(knowledge, targets), (options) =>
      rng.pick(options),
    );

    // A cell can score zero only if no remaining ship fits anywhere near it; in
    // that (rare, endgame) case any legal target is as good as another.
    return best ?? rng.pick(targets);
  },

  chooseFleet(rng: Rng): readonly Ship[] {
    return chooseLeastPredictableFleet(rng, 12);
  },
};
