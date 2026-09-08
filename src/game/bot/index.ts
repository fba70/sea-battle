/**
 * Server-side bots (spec §7.3).
 *
 * Bots are pure strategy objects: they read a `PlayerView` and return a target.
 * They never see a `GameState`, never touch `Math.random`, and hold no state of
 * their own between turns — everything they know is re-derived from the view, so
 * a bot cannot cheat even by accident.
 */
import { easyBot } from './easy';
import { hardBot } from './hard';
import { mediumBot } from './medium';
import type { BotDifficulty, BotStrategy } from './types';

export function createBot(difficulty: BotDifficulty): BotStrategy {
  switch (difficulty) {
    case 'easy':
      return easyBot;
    case 'medium':
      return mediumBot;
    case 'hard':
      return hardBot;
  }
}

export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'medium', 'hard'];

export * from './easy';
export * from './hard';
export * from './knowledge';
export * from './medium';
export * from './placement';
export * from './types';
