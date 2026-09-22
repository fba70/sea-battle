import { and, eq, isNull, or, sql } from 'drizzle-orm';

import { db as defaultDb } from '../db';
import { games } from '../db/schema/game';
import { user } from '../db/schema/auth';

import type { ClaimCounts, GuestClaimStore } from './claim';

type Database = typeof defaultDb;

/**
 * The Neon-backed implementation of the guest claim (spec §7.5, §6).
 *
 * Every write runs inside one `db.batch`, which the neon-http driver sends as a single
 * transaction. Ordering matters: the game references must move off the guest *before*
 * the guest row is deleted, because `games.player_*_id` is `ON DELETE SET NULL` and a
 * delete-first sequence would silently detach the history we are trying to preserve.
 */
export function createGuestClaimStore(database: Database = defaultDb): GuestClaimStore {
  return {
    async claim({ guestUserId, userId }): Promise<ClaimCounts> {
      const [guest] = await database
        .select({
          id: user.id,
          isAnonymous: user.isAnonymous,
          avatarSeed: user.avatarSeed,
          country: user.country,
          locale: user.locale,
        })
        .from(user)
        .where(and(eq(user.id, guestUserId), eq(user.isAnonymous, true)))
        .limit(1);

      // Already claimed and removed — a replayed link event. Nothing to do, and
      // re-running the transfer would be a no-op anyway.
      if (!guest) {
        return { games: 0, guestExisted: false };
      }

      /**
       * One statement, not three.
       *
       * `games_winner_is_a_player` (Block 2) requires `winner_id` to equal one of the
       * seat columns. A CHECK is immediate and evaluated per statement, so moving
       * `player_a_id` in one statement and `winner_id` in the next would leave the row
       * momentarily inconsistent and the constraint would reject the update. Moving all
       * three columns together keeps the row valid at every point a check can see it.
       */
      const moveOwnership = database
        .update(games)
        .set({
          playerAId: sql`case when ${games.playerAId} = ${guestUserId} then ${userId} else ${games.playerAId} end`,
          playerBId: sql`case when ${games.playerBId} = ${guestUserId} then ${userId} else ${games.playerBId} end`,
          winnerId: sql`case when ${games.winnerId} = ${guestUserId} then ${userId} else ${games.winnerId} end`,
        })
        .where(
          or(
            eq(games.playerAId, guestUserId),
            eq(games.playerBId, guestUserId),
            eq(games.winnerId, guestUserId),
          ),
        )
        .returning({ id: games.id });

      /**
       * Adopt the guest's profile into fields the new account has not set, and record
       * where it came from.
       *
       * `claimed_from_guest_id is null` makes this idempotent and makes the first claim
       * win: a second link event for an already-claimed account changes nothing.
       * `last_seen_at` is deliberately not adopted — it is a presence field, and the
       * account is being used right now.
       */
      const adoptProfile = database
        .update(user)
        .set({
          avatarSeed: sql`coalesce(${user.avatarSeed}, ${guest.avatarSeed})`,
          country: sql`coalesce(${user.country}, ${guest.country})`,
          locale: sql`coalesce(${user.locale}, ${guest.locale})`,
          claimedFromGuestId: guestUserId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(user.id, userId),
            // Never write a claim marker onto an anonymous row.
            eq(user.isAnonymous, false),
            isNull(user.claimedFromGuestId),
          ),
        );

      // The guard repeats `is_anonymous` so this can never remove a registered account,
      // whatever the caller passed. Sessions cascade with it (Block 2 FK).
      const removeGuest = database
        .delete(user)
        .where(and(eq(user.id, guestUserId), eq(user.isAnonymous, true)));

      const [moved] = await database.batch([moveOwnership, adoptProfile, removeGuest]);

      return { games: moved.length, guestExisted: true };
    },

    async discard({ guestUserId }): Promise<void> {
      // Spec §7.5: the throwaway guest is dropped, not merged. Its unrated games keep
      // existing for the opponent's history with the seat set to null.
      await database.delete(user).where(and(eq(user.id, guestUserId), eq(user.isAnonymous, true)));
    },
  };
}
