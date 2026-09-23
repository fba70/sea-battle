import { and, eq, isNull, sql } from 'drizzle-orm';

import { db as defaultDb } from '../db';
import { games, matchmakingQueue, CLASSIC_RULESET } from '../db/schema/game';

import type { LobbyStore, QueuedPlayer, Seating } from './lobby';

type Database = typeof defaultDb;

/** Postgres rejects a duplicate room code with this SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code === UNIQUE_VIOLATION
    : false;
}

/**
 * The Neon-backed lobby (spec §7.4).
 *
 * The two operations that must be atomic — claiming a room's empty seat, and pulling
 * two players out of the queue — are each a single conditional statement, so the
 * database does the arbitration rather than application code.
 */
export function createLobbyStore(database: Database = defaultDb): LobbyStore {
  return {
    async createRoom({ code, hostId, rated }) {
      try {
        const [row] = await database
          .insert(games)
          .values({
            mode: 'classic',
            type: 'private',
            rated,
            status: 'live',
            playerAId: hostId,
            joinCode: code,
            ruleset: CLASSIC_RULESET,
          })
          .returning({ id: games.id });

        if (!row) {
          throw new Error('failed to create room');
        }
        return { gameId: row.id };
      } catch (error) {
        // The unique index is the arbiter; the caller retries with a fresh code.
        if (isUniqueViolation(error)) {
          return { collision: true };
        }
        throw error;
      }
    },

    async findRoomByCode(code) {
      const rows = await database
        .select({
          gameId: games.id,
          playerAId: games.playerAId,
          playerBId: games.playerBId,
          status: games.status,
        })
        .from(games)
        .where(eq(games.joinCode, code))
        .limit(1);

      return rows[0] ?? null;
    },

    async claimSecondSeat({ gameId, playerId }) {
      // Conditional on the seat still being empty: two people opening the same link
      // at once cannot both become player B, because only one update matches.
      const updated = await database
        .update(games)
        .set({ playerBId: playerId })
        .where(and(eq(games.id, gameId), isNull(games.playerBId), eq(games.status, 'live')))
        .returning({ id: games.id });

      return updated[0] ? { gameId: updated[0].id } : null;
    },

    async enqueue({ playerId, pool, rating }) {
      // One row per player, so nobody can wait in two pools at once. Re-queueing
      // refreshes the pool and rating but deliberately keeps the original
      // `enqueued_at`, so polling does not reset a player's place in the line.
      await database
        .insert(matchmakingQueue)
        .values({ userId: playerId, pool, rating })
        .onConflictDoUpdate({
          target: matchmakingQueue.userId,
          set: { pool, rating },
        });
    },

    async takePair({ playerId, pool }): Promise<readonly QueuedPlayer[]> {
      /**
       * Spec §7.4: "pairing must be atomic so two matchers can't grab the same
       * player". One statement does it.
       *
       * The delete only fires when both sides are still present — `partner` finds the
       * longest-waiting other player in the pool, and the guard requires a row for us
       * too. With no partner the guard is false and nothing is removed, so a waiting
       * player is never dropped just for polling.
       */
      const result = await database.execute(sql`
        with partner as (
          select ${matchmakingQueue.userId} as user_id
          from ${matchmakingQueue}
          where ${matchmakingQueue.pool} = ${pool}
            and ${matchmakingQueue.userId} <> ${playerId}
          order by ${matchmakingQueue.enqueuedAt} asc
          limit 1
        ),
        mine as (
          select ${matchmakingQueue.userId} as user_id
          from ${matchmakingQueue}
          where ${matchmakingQueue.userId} = ${playerId}
            and ${matchmakingQueue.pool} = ${pool}
        )
        delete from ${matchmakingQueue}
        where (select count(*) from partner) = 1
          and (select count(*) from mine) = 1
          and ${matchmakingQueue.userId} in (
            (select user_id from partner),
            (select user_id from mine)
          )
        returning
          ${matchmakingQueue.userId} as user_id,
          ${matchmakingQueue.rating} as rating,
          ${matchmakingQueue.enqueuedAt} as enqueued_at
      `);

      return (result.rows ?? []).map((row) => {
        const record = row as { user_id: string; rating: number; enqueued_at: string | Date };
        return {
          userId: record.user_id,
          rating: Number(record.rating),
          enqueuedAt:
            record.enqueued_at instanceof Date ? record.enqueued_at : new Date(record.enqueued_at),
        };
      });
    },

    async dequeue(playerId) {
      await database.delete(matchmakingQueue).where(eq(matchmakingQueue.userId, playerId));
    },

    async createMatch({ playerAId, playerBId, rated }) {
      const [row] = await database
        .insert(games)
        .values({
          mode: 'classic',
          type: 'quickmatch',
          rated,
          status: 'live',
          playerAId,
          playerBId,
          ruleset: CLASSIC_RULESET,
        })
        .returning({ id: games.id });

      if (!row) {
        throw new Error('failed to create match');
      }
      return { gameId: row.id };
    },

    async findSeat({ gameId, playerId }): Promise<Seating | null> {
      const rows = await database
        .select({ id: games.id, playerAId: games.playerAId, playerBId: games.playerBId })
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      const row = rows[0];
      if (!row) {
        return null;
      }
      if (row.playerAId === playerId) {
        return { gameId: row.id, seat: 'a' };
      }
      if (row.playerBId === playerId) {
        return { gameId: row.id, seat: 'b' };
      }
      return null;
    },
  };
}
