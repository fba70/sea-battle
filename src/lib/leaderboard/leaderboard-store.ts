import { sql, type SQLWrapper } from 'drizzle-orm';

import { db as defaultDb } from '../db';
import { games, ratings, type GameMode, type GameType } from '../db/schema/game';
import { user } from '../db/schema/auth';
import { DEFAULT_RATING, DEFAULT_RD } from '@/rating/glicko';

import { inflatedRdSql, leaderboardEligibleSql } from '../rating/leaderboard';
import { currentRd, leaderboardEligibility } from '../rating/policy';

import type {
  BotLevel,
  LeaderboardEntry,
  MatchHistoryEntry,
  PlayerStanding,
  ResultReason,
} from './leaderboard';

type Database = typeof defaultDb;

/**
 * The Neon-backed leaderboard and profile reads (spec §7.7, §7.5).
 *
 * Three things shape these queries:
 *
 * 1. Eligibility and RD inflation come from Block 8A. `leaderboardEligibleSql` and
 *    `inflatedRdSql` are used verbatim, so the ranked read cannot drift from the
 *    policy the rest of the system applies.
 * 2. Wins and losses are derived from `games`, not from counters. `ratings` holds
 *    Glicko state only, and a second source of truth for a win would be one more
 *    thing to keep correct across forfeits, retries and erasure.
 * 3. `boards_json` is never selected. It holds both fleets (see the column comment in
 *    the schema), so it must not leave the server even for a finished game.
 *
 * Ordering is spec §7.7's — rating desc, RD asc, games desc — with `user_id` as a
 * final deterministic tiebreak so a page never reshuffles between two equal rows.
 * The RD it sorts on is the inflated one, matching the RD it filters on.
 */

/** Spec §7.7's ordering, written once so the list and the rank always agree. */
const RANKING_ORDER = (now: Date) =>
  sql`order by ${ratings.rating} desc, ${inflatedRdSql(now)} asc, ${ratings.gamesRated} desc, ${ratings.userId} asc`;

/**
 * Wins and losses over this player's completed rated games in one mode.
 *
 * A lateral so it runs once per ranked row against
 * `games_player_a_ended_at_idx` / `games_player_b_ended_at_idx`, rather than
 * aggregating the whole table and joining.
 */
const ratedRecord = (userIdExpression: SQLWrapper, mode: GameMode) => sql`
  select
    count(*) filter (where ${games.winnerId} = ${userIdExpression})::int as wins,
    count(*) filter (
      where ${games.winnerId} is not null and ${games.winnerId} <> ${userIdExpression}
    )::int as losses
  from ${games}
  where ${games.rated} = true
    and ${games.status} = 'completed'
    and ${games.mode} = ${mode}
    and (${games.playerAId} = ${userIdExpression} or ${games.playerBId} = ${userIdExpression})
`;

interface EntryRow {
  rank: number | string;
  user_id: string;
  name: string | null;
  country: string | null;
  avatar_seed: string | null;
  rating: number | string;
  rd: number | string;
  games_rated: number | string;
  wins: number | string;
  losses: number | string;
}

function toEntry(row: EntryRow): LeaderboardEntry {
  return {
    rank: Number(row.rank),
    userId: row.user_id,
    // The column is NOT NULL, but an erased seat elsewhere makes the defensive
    // fallback cheap and keeps the UI from rendering "null".
    name: row.name ?? '',
    country: row.country,
    avatarSeed: row.avatar_seed,
    rating: Number(row.rating),
    rd: Number(row.rd),
    gamesRated: Number(row.games_rated),
    wins: Number(row.wins),
    losses: Number(row.losses),
  };
}

export interface LeaderboardStore {
  /** The ranked top of one mode's ladder (spec §7.7's "Top N"). */
  topPlayers(input: {
    mode: GameMode;
    limit: number;
    now: Date;
  }): Promise<readonly LeaderboardEntry[]>;

  /** One player's rating, record and rank — null when they have no rating at all. */
  standing(input: { userId: string; mode: GameMode; now: Date }): Promise<PlayerStanding | null>;

  /** How many players are currently ranked, for the empty and "almost there" states. */
  rankedCount(input: { mode: GameMode; now: Date }): Promise<number>;

  /** A player's own finished games, most recent first (spec §2: private to them). */
  history(input: { userId: string; limit: number }): Promise<readonly MatchHistoryEntry[]>;
}

export function createLeaderboardStore(database: Database = defaultDb): LeaderboardStore {
  return {
    async topPlayers({ mode, limit, now }) {
      const result = await database.execute(sql`
        with ranked as (
          select
            ${ratings.userId} as user_id,
            ${ratings.rating} as rating,
            ${inflatedRdSql(now)} as rd,
            ${ratings.gamesRated} as games_rated,
            row_number() over (${RANKING_ORDER(now)}) as rank
          from ${ratings}
          where ${ratings.mode} = ${mode} and (${leaderboardEligibleSql(now)})
        )
        select
          ranked.rank, ranked.user_id, ranked.rating, ranked.rd, ranked.games_rated,
          ${user.name} as name, ${user.country} as country, ${user.avatarSeed} as avatar_seed,
          record.wins, record.losses
        from ranked
        join ${user} on ${user.id} = ranked.user_id
        cross join lateral (${ratedRecord(sql`ranked.user_id`, mode)}) as record
        -- Cuts the set down before the lateral runs. Without it the per-player
        -- win/loss aggregate is evaluated for every eligible player and only then
        -- truncated, which is the per-request full scan spec §7.7 warns about.
        where ranked.rank <= ${limit}
        order by ranked.rank
      `);

      return (result.rows ?? []).map((row) => toEntry(row as unknown as EntryRow));
    },

    async standing({ userId, mode, now }) {
      /**
       * Driven from `user`, not from `ratings`.
       *
       * A rating row only appears when a player's first rated game is scored, so
       * starting from `ratings` meant a newly registered player had no profile at
       * all — the page 404'd on the link in our own header. A registered account
       * always has a profile; the rating is simply the spec §7.6 starting values
       * until they play.
       *
       * Guests still get nothing: they cannot hold a rating, and their identity is
       * a throwaway.
       */
      const result = await database.execute(sql`
        select
          ${user.id} as user_id,
          coalesce(${ratings.rating}, ${DEFAULT_RATING}) as rating,
          coalesce(${ratings.rd}, ${DEFAULT_RD}) as stored_rd,
          coalesce(${ratings.gamesRated}, 0) as games_rated,
          ${ratings.lastRatingPeriodAt} as last_rating_period_at,
          ${user.name} as name, ${user.country} as country, ${user.avatarSeed} as avatar_seed,
          record.wins, record.losses
        from ${user}
        left join ${ratings}
          on ${ratings.userId} = ${user.id} and ${ratings.mode} = ${mode}
        cross join lateral (${ratedRecord(user.id, mode)}) as record
        where ${user.id} = ${userId} and ${user.isAnonymous} = false
        limit 1
      `);

      const row = (result.rows ?? [])[0] as
        | (EntryRow & { stored_rd: number | string; last_rating_period_at: string | Date | null })
        | undefined;

      if (!row) {
        return null;
      }

      const lastRatingPeriodAt =
        row.last_rating_period_at === null
          ? null
          : row.last_rating_period_at instanceof Date
            ? row.last_rating_period_at
            : new Date(row.last_rating_period_at);

      const state = {
        rd: Number(row.stored_rd),
        gamesRated: Number(row.games_rated),
        lastRatingPeriodAt,
      };

      // The decision itself is Block 8A's, applied to the row we just read — the SQL
      // predicate is only used where the database has to do the filtering.
      const eligibility = leaderboardEligibility(state, now);

      return {
        mode,
        userId: row.user_id,
        name: row.name ?? '',
        country: row.country,
        avatarSeed: row.avatar_seed,
        rating: Number(row.rating),
        rd: currentRd(state, now),
        storedRd: state.rd,
        gamesRated: state.gamesRated,
        lastRatingPeriodAt,
        wins: Number(row.wins),
        losses: Number(row.losses),
        eligibility,
        rank: eligibility.eligible ? await rankOf(database, userId, mode, now) : null,
      };
    },

    async rankedCount({ mode, now }) {
      const result = await database.execute(sql`
        select count(*)::int as ranked
        from ${ratings}
        where ${ratings.mode} = ${mode} and (${leaderboardEligibleSql(now)})
      `);

      return Number((result.rows ?? [])[0]?.ranked ?? 0);
    },

    async history({ userId, limit }) {
      /**
       * Both seats in one read. `opponent_id` picks the other seat, and the rating
       * delta is taken from the seat this player occupied, so the number shown is
       * always theirs.
       *
       * Deliberately selects no `boards_json`: that column holds both fleets.
       */
      const result = await database.execute(sql`
        select
          ${games.id} as game_id,
          ${games.mode} as mode,
          ${games.type} as type,
          ${games.rated} as rated,
          ${games.endedAt} as ended_at,
          ${games.winnerId} as winner_id,
          ${games.resultReason} as result_reason,
          ${games.moveCount} as move_count,
          ${games.botLevel} as bot_level,
          case when ${games.playerAId} = ${userId}
               then ${games.ratingDeltaA} else ${games.ratingDeltaB} end as rating_delta,
          opponent.name as opponent_name
        from ${games}
        left join ${user} as opponent
          on opponent.id = case when ${games.playerAId} = ${userId}
                                then ${games.playerBId} else ${games.playerAId} end
        where ${games.status} = 'completed'
          and (${games.playerAId} = ${userId} or ${games.playerBId} = ${userId})
        order by ${games.endedAt} desc nulls last
        limit ${limit}
      `);

      return (result.rows ?? []).map((raw) => {
        const row = raw as unknown as {
          game_id: string;
          mode: string;
          type: string;
          rated: boolean;
          ended_at: string | Date | null;
          winner_id: string | null;
          result_reason: string | null;
          move_count: number | string;
          bot_level: string | null;
          rating_delta: number | string | null;
          opponent_name: string | null;
        };

        return {
          gameId: row.game_id,
          // Constrained to the schema's value lists by games_mode_valid,
          // games_type_valid and games_result_reason_valid.
          mode: row.mode as GameMode,
          type: row.type as GameType,
          rated: row.rated,
          endedAt:
            row.ended_at === null
              ? null
              : row.ended_at instanceof Date
                ? row.ended_at
                : new Date(row.ended_at),
          won: row.winner_id === null ? null : row.winner_id === userId,
          resultReason: row.result_reason as ResultReason | null,
          moveCount: Number(row.move_count),
          opponentName: row.opponent_name,
          botLevel: row.bot_level as BotLevel | null,
          ratingDelta: row.rating_delta === null ? null : Number(row.rating_delta),
        } satisfies MatchHistoryEntry;
      });
    },
  };
}

/**
 * A ranked player's position.
 *
 * Numbered with the same window function and the same ordering as `topPlayers`, so a
 * player's "you are 14th" can never disagree with the row they occupy on the board.
 */
async function rankOf(
  database: Database,
  userId: string,
  mode: GameMode,
  now: Date,
): Promise<number | null> {
  const result = await database.execute(sql`
    select rank from (
      select
        ${ratings.userId} as user_id,
        row_number() over (${RANKING_ORDER(now)}) as rank
      from ${ratings}
      where ${ratings.mode} = ${mode} and (${leaderboardEligibleSql(now)})
    ) as ranked
    where ranked.user_id = ${userId}
  `);

  const rank = (result.rows ?? [])[0]?.rank;
  return rank === undefined || rank === null ? null : Number(rank);
}
