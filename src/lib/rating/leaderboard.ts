import { and, gte, isNotNull, lt, sql, type SQL } from 'drizzle-orm';

import { MAX_RD } from '@/rating/glicko';

import { ratings } from '../db/schema/game';
import {
  GLICKO_SYSTEM_CONSTANT,
  LEADERBOARD_INACTIVITY_DAYS,
  LEADERBOARD_MAX_RD,
  LEADERBOARD_MIN_RATED_GAMES,
  RATING_PERIOD_MS,
} from './policy';

/**
 * Leaderboard eligibility as SQL (spec §7.7).
 *
 * The ranked query cannot filter on the stored `rd` column. Spec §7.6 applies RD
 * inflation lazily — nothing writes a player's grown RD until their next rated match
 * — so `ratings.rd` is only accurate as of that match. A player who settled at RD 149
 * and then vanished still has 149 in the row while their real uncertainty has grown
 * past the gate. The predicate therefore recomputes the inflated RD in the database,
 * from the same formula and the same constants as `policy.ts`.
 *
 * Deliberately a predicate and an expression rather than a finished query: the
 * leaderboard read, its columns, its ordering and its caching are Block 8B.
 *
 * Performance note: this is a residual filter, not an indexable one, so
 * `ratings_mode_rating_idx` still orders the scan but the eligibility test is applied
 * per row. That is fine at this scale and is exactly why spec §7.7 offers
 * `leaderboard_snapshots` for later.
 */

/** Seconds in one rating period, so the SQL and the TypeScript divide by the same unit. */
const RATING_PERIOD_SECONDS = RATING_PERIOD_MS / 1000;

/**
 * Rating periods elapsed since the player's last rated match, as a fraction.
 *
 * Mirrors `elapsedRatingPeriods`: `coalesce` turns a player who has never been rated
 * into 0 elapsed periods, and `greatest(…, 0)` absorbs the clock skew that can make
 * `now` precede the stored stamp.
 */
function elapsedPeriodsSql(now: Date): SQL<number> {
  return sql<number>`greatest(coalesce(extract(epoch from (${now.toISOString()}::timestamptz - ${ratings.lastRatingPeriodAt})) / ${RATING_PERIOD_SECONDS}, 0), 0)`;
}

/**
 * Spec §7.6's `min(sqrt(RD² + c²·t), 350)`, evaluated as of `now`.
 *
 * Block 8B selects this alongside the rating so a profile can show how settled a
 * rating is, rather than the stale stored value.
 */
export function inflatedRdSql(now: Date): SQL<number> {
  return sql<number>`least(sqrt(power(${ratings.rd}, 2) + power(${GLICKO_SYSTEM_CONSTANT}, 2) * ${elapsedPeriodsSql(now)}), ${MAX_RD})`;
}

/**
 * The active-leaderboard filter: enough rated games, a recent enough rated match, and
 * a current RD under the threshold.
 *
 * A transcription of `leaderboardEligibility`. The conjuncts are in a different order
 * — `and` is commutative, and only the yes/no matters here, whereas the TypeScript
 * version orders its checks to produce the most useful exclusion reason. Both gates
 * are strict in the same direction: `rd < 150`, `elapsed < 30`, `games >= 10`.
 *
 * The tests pin the emitted SQL's parameters against the same policy constants, so a
 * change to a product decision cannot leave this predicate behind on the old number.
 */
export function leaderboardEligibleSql(now: Date): SQL<unknown> {
  // `and` is typed as possibly-undefined because it accepts undefined conjuncts and
  // drops them; with four literal arguments it always returns a condition.
  return and(
    isNotNull(ratings.lastRatingPeriodAt),
    gte(ratings.gamesRated, LEADERBOARD_MIN_RATED_GAMES),
    lt(elapsedPeriodsSql(now), LEADERBOARD_INACTIVITY_DAYS),
    lt(inflatedRdSql(now), LEADERBOARD_MAX_RD),
  ) as SQL<unknown>;
}
