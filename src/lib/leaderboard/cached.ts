import { unstable_cache } from 'next/cache';

import type { GameMode } from '../db/schema/game';

import { createLeaderboardStore } from './leaderboard-store';
import type { LeaderboardEntry } from './leaderboard';

/**
 * The cached ranked read (spec §7.7).
 *
 * §7.7 asks for "a cached snapshot … Cache read responses in Upstash", but this
 * project is free-tier only and no Redis is provisioned. Next's own data cache gives
 * the same two properties the acceptance criteria actually name — a defined freshness
 * window, and no table scan per request — without new infrastructure. Swapping in
 * `leaderboard_snapshots` or Upstash later is a change to this file.
 *
 * The instant used for RD inflation is taken inside the cached function rather than
 * passed in: as an argument it would be part of the cache key and every request would
 * miss.
 */

/** Spec §7.7's "defined freshness window". */
export const LEADERBOARD_FRESHNESS_SECONDS = 60;

/** How many rows the board shows. Spec §7.7's "Top N". */
export const LEADERBOARD_TOP_N = 50;

export interface CachedBoard {
  readonly entries: readonly LeaderboardEntry[];
  /** Everyone who qualifies, which can exceed the rows shown. */
  readonly rankedCount: number;
}

export const loadBoard = unstable_cache(
  async (mode: GameMode, limit: number): Promise<CachedBoard> => {
    const store = createLeaderboardStore();
    const now = new Date();

    const [entries, rankedCount] = await Promise.all([
      store.topPlayers({ mode, limit, now }),
      store.rankedCount({ mode, now }),
    ]);

    return { entries, rankedCount };
  },
  ['leaderboard-board'],
  { revalidate: LEADERBOARD_FRESHNESS_SECONDS, tags: ['leaderboard'] },
);
