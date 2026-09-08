import { autoPlaceFleet } from '../autoplace';
import type { Rng } from '../rng';
import type { Coord, Ship } from '../types';
import { legalTargetsFromView, type PlayerView } from '../view';
import type { BotStrategy } from './types';

/**
 * Spec §7.3 Easy: "Uniform random valid target; no repeat. Random legal placement."
 *
 * No repeat comes for free — `legalTargetsFromView` only ever returns cells that
 * are still `unknown`, so fired and known-empty cells are already excluded.
 */
export const easyBot: BotStrategy = {
  difficulty: 'easy',

  chooseShot(view: PlayerView, rng: Rng): Coord {
    const targets = legalTargetsFromView(view);
    if (targets.length === 0) {
      throw new Error('Easy bot has no legal target left');
    }
    return rng.pick(targets);
  },

  chooseFleet(rng: Rng): readonly Ship[] {
    return autoPlaceFleet(rng);
  },
};
