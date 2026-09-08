import type { Rng } from '../rng';
import type { Coord, Ship } from '../types';
import type { PlayerView } from '../view';

/** Spec §7.3: three server-side difficulty levels. */
export type BotDifficulty = 'easy' | 'medium' | 'hard';

/**
 * A bot is a pure function of what a player is allowed to see.
 *
 * `chooseShot` takes a `PlayerView`, never a `GameState`, so a bot is
 * structurally incapable of reading un-revealed opponent ship positions — the
 * anti-cheat guarantee is enforced by the type signature, not by convention.
 */
export interface BotStrategy {
  readonly difficulty: BotDifficulty;
  /** Picks a legal target from the visible view. Throws if no legal target exists. */
  chooseShot(view: PlayerView, rng: Rng): Coord;
  /** Produces this bot's own fleet. Always satisfies the spec §4 constraints. */
  chooseFleet(rng: Rng): readonly Ship[];
}

/**
 * Spec §7.3: "small randomized thinking delays (e.g. 300-900ms) so the bot feels
 * human-paced". The engine stays pure — it only reports how long the caller
 * should wait; it never sleeps or reads a clock itself.
 */
export function thinkingDelayMs(rng: Rng, minMs = 300, maxMs = 900): number {
  return minMs + rng.nextInt(Math.max(1, maxMs - minMs + 1));
}
