import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { BOARD_SIZE, FLEET } from '@/game/constants';
import type { EncodedGameState } from '@/game/codec';

import { user } from './auth';

/**
 * Phase 1 game and rating tables (spec §6).
 *
 * Scope note: this is the data model only. Nothing writes to these tables yet —
 * matchmaking, the realtime session transport and the rating algorithm are later
 * blocks. Tables §6 defines for Phase 2+ (game_events, badges, streaks, tournaments,
 * cosmetics, purchases, leaderboard_snapshots) are deliberately absent.
 */

/** Spec §4: Classic ships now, Salvo in Phase 2. */
export const GAME_MODES = ['classic', 'salvo'] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** Spec §6 `games.type`. */
export const GAME_TYPES = ['bot', 'private', 'quickmatch'] as const;
export type GameType = (typeof GAME_TYPES)[number];

/**
 * Row lifecycle, which is not the engine's `GamePhase`.
 *
 * A row exists from the moment a game is created (a room waiting for an opponent is
 * already a row), so "is it over" needs to be explicit rather than inferred from a
 * null `ended_at`. `aborted` covers a game that ended without a result — a room nobody
 * joined, say — which §4's forfeit rules do not cover. A refinement of §6, which
 * sketches only `started_at` / `ended_at`.
 */
export const GAME_STATUSES = ['live', 'completed', 'aborted'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/** Spec §6 `games.result_reason`; mirrors `ResultReason` in the engine. */
export const RESULT_REASONS = ['sunk_all', 'forfeit', 'timeout', 'disconnect'] as const;

/** Mirrors `BotDifficulty` in src/game/bot/types.ts. */
export const BOT_LEVELS = ['easy', 'medium', 'hard'] as const;

/**
 * What `games.ruleset_json` records, so a historical game stays interpretable if the
 * ruleset is ever made configurable (spec §4 asks for the Classic extra-turn rule to
 * be "a rule flag so Western mode is a later toggle").
 *
 * Every value is derived from the engine's own constants — nothing here is an
 * unresolved product decision.
 */
export interface PersistedRuleset {
  readonly boardSize: number;
  readonly fleet: readonly {
    readonly shipClass: string;
    readonly size: number;
    readonly count: number;
  }[];
  /** Spec §4 Classic: a hit lets you fire again. False would be the Western variant. */
  readonly hitGrantsExtraTurn: boolean;
}

/** The ruleset the engine implements today. */
export const CLASSIC_RULESET: PersistedRuleset = {
  boardSize: BOARD_SIZE,
  fleet: FLEET.map((entry) => ({
    shipClass: entry.shipClass,
    size: entry.size,
    count: entry.count,
  })),
  hitGrantsExtraTurn: true,
};

function oneOf(column: string, values: readonly string[]): ReturnType<typeof sql.raw> {
  return sql.raw(`"${column}" in (${values.map((value) => `'${value}'`).join(', ')})`);
}

// ---------------------------------------------------------------------------
// games
// ---------------------------------------------------------------------------

/**
 * One game, live or finished (spec §6).
 *
 * Seats are two columns rather than a participants table because the engine and the
 * session layer are built around exactly two fixed seats (`PlayerSlot = 'a' | 'b'`),
 * and §6 models it the same way. That also makes `rating_delta_a` / `rating_delta_b`
 * natural instead of requiring a join.
 *
 * Both seat columns are nullable with `ON DELETE SET NULL`: spec §11 requires a GDPR
 * erasure path, and cascading would delete the *opponent's* match history along with
 * the departing player's. Setting null anonymises the seat and keeps the record.
 */
export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    mode: text('mode').notNull().default('classic'),
    type: text('type').notNull(),
    status: text('status').notNull().default('live'),

    /** Spec §4: bot games never rated; private unrated by default; quickmatch rated. */
    rated: boolean('rated').notNull().default(false),

    playerAId: text('player_a_id').references(() => user.id, { onDelete: 'set null' }),
    /** Null for a bot game (spec §6), or after the opponent's account is erased. */
    playerBId: text('player_b_id').references(() => user.id, { onDelete: 'set null' }),

    /**
     * Spec §6 says a bot game should "store bot level" but defines no column. The
     * smallest faithful representation is the engine's own difficulty label.
     */
    botLevel: text('bot_level'),

    winnerId: text('winner_id').references(() => user.id, { onDelete: 'set null' }),
    resultReason: text('result_reason'),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),

    /** Spec §6; denormalised from the state below so history queries need no decode. */
    moveCount: integer('move_count').notNull().default(0),

    ruleset: jsonb('ruleset_json').$type<PersistedRuleset>(),

    /**
     * The authoritative game state, encoded by `encodeGameState()` from Block 1.
     *
     * Named `boards_json` per spec §6, and it does hold the final boards — but it holds
     * the whole encoded state, because the engine's `shots` / `revealedEmpty` are `Set`s
     * that `JSON.stringify` silently drops. `src/game/codec.ts` is the only serialiser;
     * this column stores its output verbatim and nothing else writes this shape.
     *
     * SECURITY: this contains BOTH fleets. It is server-side state. A row from this
     * table must never be handed to a client — participants get
     * `createPlayerView(state, seat)`, and non-participants get nothing.
     */
    boards: jsonb('boards_json').$type<EncodedGameState>(),

    /** Null until a rated game is scored (spec §6). */
    ratingDeltaA: doublePrecision('rating_delta_a'),
    ratingDeltaB: doublePrecision('rating_delta_b'),
  },
  (table) => [
    // Spec §6: "games(player_a_id/player_b_id, ended_at) for history".
    index('games_player_a_ended_at_idx').on(table.playerAId, table.endedAt),
    index('games_player_b_ended_at_idx').on(table.playerBId, table.endedAt),

    check('games_mode_valid', oneOf('mode', GAME_MODES)),
    check('games_type_valid', oneOf('type', GAME_TYPES)),
    check('games_status_valid', oneOf('status', GAME_STATUSES)),
    check(
      'games_result_reason_valid',
      sql`"result_reason" is null or ${oneOf('result_reason', RESULT_REASONS)}`,
    ),
    check('games_bot_level_valid', sql`"bot_level" is null or ${oneOf('bot_level', BOT_LEVELS)}`),

    /**
     * A bot game has a level and no second human; every other game is the reverse.
     * Keeps `type` and the seat columns from drifting apart.
     */
    check(
      'games_bot_shape',
      sql`("type" = 'bot' and "bot_level" is not null and "player_b_id" is null)
          or ("type" <> 'bot' and "bot_level" is null)`,
    ),

    /** Spec §4: bot games are never rated. */
    check('games_bot_games_unrated', sql`not "rated" or "type" <> 'bot'`),

    /**
     * "Rated requires two *registered* players" (spec §4) is only half-expressible
     * here, because a seat column cannot see whether the user it points at is a guest.
     * The other half is enforced structurally: a rating can only move through the
     * `ratings` table, and a guest cannot have a row there at all.
     */
    check(
      'games_rating_delta_requires_rated',
      sql`"rated" or ("rating_delta_a" is null and "rating_delta_b" is null)`,
    ),

    /** The winner must be one of the seats — or null, including after an erasure. */
    check(
      'games_winner_is_a_player',
      sql`"winner_id" is null or "winner_id" = "player_a_id" or "winner_id" = "player_b_id"`,
    ),

    /** Lifecycle coherence, so a row cannot be half-finished. */
    check(
      'games_status_coherent',
      sql`("status" = 'live' and "ended_at" is null and "winner_id" is null and "result_reason" is null)
          or ("status" = 'completed' and "ended_at" is not null and "result_reason" is not null)
          or ("status" = 'aborted' and "ended_at" is not null)`,
    ),

    check('games_move_count_non_negative', sql`"move_count" >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// ratings
// ---------------------------------------------------------------------------

/**
 * Glicko-1 state per registered player, per mode (spec §6, §7.6).
 *
 * Keyed `(user_id, mode)` even though only Classic exists, so adding Salvo in Phase 2
 * is an insert rather than a table redesign. Only `mode = 'classic'` is written today.
 *
 * The algorithm itself is a later block. This table stores only what Glicko-1 needs to
 * *be* run: the spec-standard starting values, the counters, and a timestamp for the
 * RD inflation that elapsed time causes. It deliberately encodes none of SeaDuel's
 * unresolved rating decisions — no system constant `c`, no rating-period length, no
 * provisional threshold.
 */
export const ratings = pgTable(
  'ratings',
  {
    userId: text('user_id').notNull(),

    /**
     * Guest guard (agreed product model: guests play unrated and never acquire a
     * competitive rating). A `CHECK` cannot read another table, so the user's flag is
     * mirrored here, pinned to false, and tied back by a composite foreign key. The
     * result is fully declarative: no row can reference an anonymous user, and an
     * attempt to turn a rated user back into a guest fails instead of silently
     * leaving a guest holding a rating.
     */
    ownerIsAnonymous: boolean('owner_is_anonymous').notNull().default(false),

    mode: text('mode').notNull().default('classic'),

    /** Glicko's standard starting values, named in spec §6 — not product choices. */
    rating: doublePrecision('rating').notNull().default(1500),
    rd: doublePrecision('rd').notNull().default(350),

    /** Reserved for Glicko-2's volatility σ (spec §6); unused by Glicko-1. */
    volatility: doublePrecision('volatility'),

    /** When this rating was last recalculated — the input to lazy RD inflation. */
    lastRatingPeriodAt: timestamp('last_rating_period_at', { withTimezone: true }),

    gamesRated: integer('games_rated').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.mode] }),

    foreignKey({
      name: 'ratings_registered_user_fk',
      columns: [table.userId, table.ownerIsAnonymous],
      foreignColumns: [user.id, user.isAnonymous],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    // Spec §6 asks for "ratings(rating desc) for leaderboard"; with mode now part of
    // the key, the leaderboard reads one mode at a time.
    index('ratings_mode_rating_idx').on(table.mode, table.rating.desc()),

    check('ratings_mode_valid', oneOf('mode', GAME_MODES)),
    check('ratings_owner_is_registered', sql`"owner_is_anonymous" = false`),
    check('ratings_rd_non_negative', sql`"rd" >= 0`),
    check('ratings_games_rated_non_negative', sql`"games_rated" >= 0`),
  ],
);

export type GameRow = typeof games.$inferSelect;
export type NewGameRow = typeof games.$inferInsert;
export type RatingRow = typeof ratings.$inferSelect;
export type NewRatingRow = typeof ratings.$inferInsert;
