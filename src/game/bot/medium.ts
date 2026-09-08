import { toIndex } from '../coord';
import type { Rng } from '../rng';
import type { Coord, Ship } from '../types';
import { legalTargetsFromView, type PlayerView } from '../view';
import { chooseLeastPredictableFleet } from './placement';
import { readKnowledge, type BotKnowledge } from './knowledge';
import type { BotStrategy } from './types';

const DIRECTIONS: readonly Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

interface TargetCandidates {
  /** Cells that continue a line of two or more in-line hits. */
  readonly extending: Coord[];
  /** Cells merely orthogonally adjacent to a lone hit. */
  readonly adjacent: Coord[];
}

/**
 * Target mode (spec §7.3): "probe orthogonal neighbors; once two in-line hits,
 * continue along the line until sink."
 *
 * For each unresolved hit we walk outwards in all four directions. Running over
 * further hits before reaching an unknown cell means we are extending a known
 * line, which is strictly better information than probing a lone hit — because
 * ships may not touch, two orthogonally adjacent hits must belong to one ship.
 */
export function targetCandidates(knowledge: BotKnowledge): TargetCandidates {
  const extending = new Map<number, Coord>();
  const adjacent = new Map<number, Coord>();

  for (const hit of knowledge.unresolvedHits) {
    for (const direction of DIRECTIONS) {
      let steps = 1;
      let cursor = { x: hit.x + direction.x, y: hit.y + direction.y };

      while (knowledge.cellState(cursor) === 'hit') {
        steps += 1;
        cursor = { x: cursor.x + direction.x, y: cursor.y + direction.y };
      }

      if (knowledge.cellState(cursor) !== 'unknown') {
        continue;
      }

      if (steps > 1) {
        extending.set(toIndex(cursor), cursor);
      } else {
        adjacent.set(toIndex(cursor), cursor);
      }
    }
  }

  return { extending: [...extending.values()], adjacent: [...adjacent.values()] };
}

/**
 * Hunt mode (spec §7.3): fire on a checkerboard so the search cost halves — any
 * ship of length >= 2 must cover at least one parity cell. Falls back to the full
 * target list once the parity cells run out (the 1-cell submarines live there).
 */
export function parityTargets(targets: readonly Coord[]): Coord[] {
  const parity = targets.filter((coord) => (coord.x + coord.y) % 2 === 0);
  return parity.length > 0 ? parity : [...targets];
}

export const mediumBot: BotStrategy = {
  difficulty: 'medium',

  chooseShot(view: PlayerView, rng: Rng): Coord {
    const targets = legalTargetsFromView(view);
    if (targets.length === 0) {
      throw new Error('Medium bot has no legal target left');
    }

    const knowledge = readKnowledge(view);
    const { extending, adjacent } = targetCandidates(knowledge);

    if (extending.length > 0) {
      return rng.pick(extending);
    }
    if (adjacent.length > 0) {
      return rng.pick(adjacent);
    }

    return rng.pick(parityTargets(targets));
  },

  chooseFleet(rng: Rng): readonly Ship[] {
    // "Balanced placement (some edge bias)" — a light sample, well short of Hard's.
    return chooseLeastPredictableFleet(rng, 4);
  },
};
