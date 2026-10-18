import { LEADERBOARD_MIN_RATED_GAMES, type LeaderboardEligibility } from '../rating/policy';
import type { BOT_LEVELS, GameMode, GameType, RESULT_REASONS } from '../db/schema/game';

/** The literal unions behind the schema's value lists, for the history projection. */
export type ResultReason = (typeof RESULT_REASONS)[number];
export type BotLevel = (typeof BOT_LEVELS)[number];

/**
 * The leaderboard and player profile read model (spec §7.7, §7.5).
 *
 * Types and pure helpers only. The queries are in `leaderboard-store.ts`, and every
 * eligibility decision comes from Block 8A's `rating/policy.ts` — this module never
 * restates a threshold.
 *
 * SECURITY: nothing here carries board state. A completed game's `boards_json` holds
 * both fleets, so the history projection below lists only the scalar facts about a
 * game. Spec §2 also keeps game history private to the player in v1, which is why
 * history is a separate read from the public profile rather than part of it.
 */

/** Who a player is, for a leaderboard row or a profile header. */
export interface PlayerIdentity {
  readonly userId: string;
  readonly name: string;
  /** Spec §7.7's optional flag; null until a profile sets one. */
  readonly country: string | null;
  /** Spec §7.5's deterministic avatar seed; the name is the fallback. */
  readonly avatarSeed: string | null;
}

/** Wins and losses, derived from completed rated games rather than a counter. */
export interface RatedRecord {
  readonly wins: number;
  readonly losses: number;
}

export interface LeaderboardEntry extends PlayerIdentity, RatedRecord {
  readonly rank: number;
  readonly rating: number;
  /** RD as of the query instant, with inactivity growth already applied. */
  readonly rd: number;
  readonly gamesRated: number;
}

/**
 * One player's position, whether or not they are ranked.
 *
 * `rank` is null exactly when `eligibility.eligible` is false, which is what the
 * "around me" card (spec §7.7) and the profile both render from.
 */
export interface PlayerStanding extends PlayerIdentity, RatedRecord {
  readonly mode: GameMode;
  readonly rating: number;
  /** RD as of the query instant — what every decision uses. */
  readonly rd: number;
  /** RD as last written by a rated match, before inactivity growth. */
  readonly storedRd: number;
  readonly gamesRated: number;
  readonly lastRatingPeriodAt: Date | null;
  readonly eligibility: LeaderboardEligibility;
  readonly rank: number | null;
}

/** One finished game in a player's own history (spec §7.5, §2: private to them). */
export interface MatchHistoryEntry {
  readonly gameId: string;
  readonly mode: GameMode;
  readonly type: GameType;
  readonly rated: boolean;
  readonly endedAt: Date | null;
  /** Null when the game ended without a winner. */
  readonly won: boolean | null;
  readonly resultReason: ResultReason | null;
  readonly moveCount: number;
  /** Null for a bot game, or once the opponent's account is erased (spec §11). */
  readonly opponentName: string | null;
  readonly botLevel: BotLevel | null;
  /** This player's rating change, null for an unrated game. */
  readonly ratingDelta: number | null;
}

/**
 * Share of decided games won, or null when there are none to divide by.
 *
 * Null rather than 0 on purpose: "no games yet" and "lost every game" are different
 * things, and a leaderboard that prints 0% for both is lying about one of them.
 */
export function winRate(record: RatedRecord): number | null {
  const decided = record.wins + record.losses;
  return decided === 0 ? null : record.wins / decided;
}

/** How many more rated games a player needs before the games gate opens. */
export function gamesUntilRanked(gamesRated: number): number {
  return Math.max(0, LEADERBOARD_MIN_RATED_GAMES - gamesRated);
}
