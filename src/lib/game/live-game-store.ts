import { and, eq } from 'drizzle-orm';

import { db as defaultDb } from '../db';
import { games, CLASSIC_RULESET } from '../db/schema/game';

import type {
  CompleteLiveGameInput,
  CreateLiveGameInput,
  LiveGameRecord,
  LiveGameStore,
} from './live-game';

type Database = typeof defaultDb;

/** The Neon-backed implementation of the live-game lifecycle (spec §6). */
export function createLiveGameStore(database: Database = defaultDb): LiveGameStore {
  return {
    async create(input: CreateLiveGameInput) {
      const [row] = await database
        .insert(games)
        .values({
          mode: input.mode,
          type: input.type,
          rated: input.rated,
          status: 'live',
          playerAId: input.playerAId,
          playerBId: input.playerBId,
          // Recorded at creation so a historical game stays interpretable if the
          // ruleset ever becomes configurable (spec §4).
          ruleset: CLASSIC_RULESET,
        })
        .returning({ id: games.id });

      if (!row) {
        throw new Error('failed to create live game');
      }
      return row;
    },

    async load(gameId: string): Promise<LiveGameRecord | null> {
      const rows = await database
        .select({
          id: games.id,
          playerAId: games.playerAId,
          playerBId: games.playerBId,
          status: games.status,
        })
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      return rows[0] ?? null;
    },

    async complete(input: CompleteLiveGameInput) {
      /**
       * A compare-and-set on `status = 'live'`, so a retried or duplicated result
       * report completes the game exactly once.
       *
       * Every field the status CHECK requires is written in this one statement:
       * Block 2's `games_status_coherent` demands that a completed game carries an
       * end time and a result reason, and it is evaluated per statement.
       */
      const updated = await database
        .update(games)
        .set({
          status: 'completed',
          endedAt: new Date(),
          winnerId: input.winnerId,
          resultReason: input.resultReason,
          moveCount: input.moveCount,
          boards: input.state,
        })
        .where(and(eq(games.id, input.gameId), eq(games.status, 'live')))
        .returning({ id: games.id });

      return { completed: updated.length > 0 };
    },
  };
}
