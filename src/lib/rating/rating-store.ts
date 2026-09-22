import { and, eq, inArray, sql } from 'drizzle-orm';

import { db as defaultDb } from '../db';
import { games, ratings, type GameMode } from '../db/schema/game';

import type { StoredGameForRating } from './eligibility';
import type { ApplyRatedResultInput, RatingSnapshot, RatingStore } from './process';

type Database = typeof defaultDb;

/**
 * The Neon-backed rating store (spec §6, §7.6).
 *
 * Everything interesting is in `applyRatedResult`, which is one statement for a
 * reason — see the comment there.
 */
export function createRatingStore(database: Database = defaultDb): RatingStore {
  return {
    async loadGame(gameId: string): Promise<StoredGameForRating | null> {
      // The guest flags come from a join rather than a second round trip, so
      // eligibility is decided from one consistent read of the authoritative row.
      const rows = await database
        .select({
          id: games.id,
          mode: games.mode,
          type: games.type,
          status: games.status,
          rated: games.rated,
          playerAId: games.playerAId,
          playerBId: games.playerBId,
          winnerId: games.winnerId,
          endedAt: games.endedAt,
          ratingDeltaA: games.ratingDeltaA,
          ratingDeltaB: games.ratingDeltaB,
          playerAIsAnonymous: sql<
            boolean | null
          >`(select u."is_anonymous" from "user" u where u."id" = ${games.playerAId})`,
          playerBIsAnonymous: sql<
            boolean | null
          >`(select u."is_anonymous" from "user" u where u."id" = ${games.playerBId})`,
        })
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      return rows[0] ?? null;
    },

    async loadRatings(userIds: readonly string[], mode: GameMode): Promise<RatingSnapshot[]> {
      if (userIds.length === 0) {
        return [];
      }

      return database
        .select({ userId: ratings.userId, rating: ratings.rating, rd: ratings.rd })
        .from(ratings)
        .where(and(inArray(ratings.userId, [...userIds]), eq(ratings.mode, mode)));
    },

    async applyRatedResult(input: ApplyRatedResultInput): Promise<{ applied: boolean }> {
      /**
       * One statement, so the whole thing is atomic and exactly-once.
       *
       * `claimed` is a compare-and-set: it only matches while the game is rated,
       * completed and *still unrated* (both deltas null). Writing the deltas is
       * therefore the act of claiming the game.
       *
       * Both rating upserts select `from claimed`, so if the CAS matched nothing they
       * insert nothing and update nothing. That is what makes a retry or a concurrent
       * call harmless: under READ COMMITTED the second writer blocks on the game row,
       * re-checks the WHERE against the committed version, finds the deltas already
       * set, and every dependent write collapses to zero rows. No rating is awarded
       * twice and no partial state is possible, because it is a single statement.
       *
       * `on conflict do update` covers a player who has no ratings row yet: spec §7.6
       * starts them at 1500/350, which is exactly the snapshot the caller rated from.
       */
      const result = await database.execute(sql`
        with claimed as (
          update ${games} set
            ${sql.identifier('rating_delta_a')} = ${input.a.delta},
            ${sql.identifier('rating_delta_b')} = ${input.b.delta}
          where ${games.id} = ${input.gameId}
            and ${games.rated} = true
            and ${games.status} = 'completed'
            and ${games.ratingDeltaA} is null
            and ${games.ratingDeltaB} is null
          returning ${games.id}
        ),
        rated_a as (
          insert into ${ratings}
            (${sql.identifier('user_id')}, ${sql.identifier('mode')}, ${sql.identifier('rating')},
             ${sql.identifier('rd')}, ${sql.identifier('games_rated')},
             ${sql.identifier('last_rating_period_at')}, ${sql.identifier('updated_at')})
          select ${input.a.userId}, ${input.mode}, ${input.a.next.rating},
                 ${input.a.next.rd}, 1, ${input.ratedAt}, ${input.ratedAt}
          from claimed
          on conflict (${sql.identifier('user_id')}, ${sql.identifier('mode')}) do update set
            ${sql.identifier('rating')} = excluded.${sql.identifier('rating')},
            ${sql.identifier('rd')} = excluded.${sql.identifier('rd')},
            ${sql.identifier('games_rated')} = ${ratings.gamesRated} + 1,
            ${sql.identifier('last_rating_period_at')} = excluded.${sql.identifier('last_rating_period_at')},
            ${sql.identifier('updated_at')} = excluded.${sql.identifier('updated_at')}
          returning ${sql.identifier('user_id')}
        ),
        rated_b as (
          insert into ${ratings}
            (${sql.identifier('user_id')}, ${sql.identifier('mode')}, ${sql.identifier('rating')},
             ${sql.identifier('rd')}, ${sql.identifier('games_rated')},
             ${sql.identifier('last_rating_period_at')}, ${sql.identifier('updated_at')})
          select ${input.b.userId}, ${input.mode}, ${input.b.next.rating},
                 ${input.b.next.rd}, 1, ${input.ratedAt}, ${input.ratedAt}
          from claimed
          on conflict (${sql.identifier('user_id')}, ${sql.identifier('mode')}) do update set
            ${sql.identifier('rating')} = excluded.${sql.identifier('rating')},
            ${sql.identifier('rd')} = excluded.${sql.identifier('rd')},
            ${sql.identifier('games_rated')} = ${ratings.gamesRated} + 1,
            ${sql.identifier('last_rating_period_at')} = excluded.${sql.identifier('last_rating_period_at')},
            ${sql.identifier('updated_at')} = excluded.${sql.identifier('updated_at')}
          returning ${sql.identifier('user_id')}
        )
        select
          (select count(*) from claimed)::int as claimed,
          (select count(*) from rated_a)::int as rated_a,
          (select count(*) from rated_b)::int as rated_b
      `);

      const row = (result.rows ?? [])[0] as
        { claimed: number; rated_a: number; rated_b: number } | undefined;

      return { applied: (row?.claimed ?? 0) > 0 };
    },
  };
}
