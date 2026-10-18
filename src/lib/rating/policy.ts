import { inflateRd, MAX_RD } from '@/rating/glicko';

/**
 * SeaDuel's rating and leaderboard policy (spec §7.6, §7.7).
 *
 * Spec §7.6 defines the Glicko-1 *mechanism* but deliberately leaves four numbers to
 * tuning: the system constant `c`, the rating-period length, and §7.7's minimum
 * games-played / maximum-RD thresholds. §7.7 also says nothing at all about
 * inactivity. Those are product decisions, and this module is the single place they
 * are written down — `src/rating/glicko.ts` stays a pure transcription of the paper
 * and takes `c` as an argument so it can never inherit one of these silently.
 *
 * Pure and clock-free, exactly like the math it wraps: every function takes the
 * reference instant as an argument. That is what keeps rating processing replayable —
 * re-running a game months later reproduces the same numbers, because the instant
 * comes from the stored game rather than from `Date.now()`.
 *
 * PRODUCT DECISIONS (agreed, not spec requirements) — see the constants below.
 */

/**
 * One rating period is a day. Spec §7.6 offers per-game updates or short batch
 * periods and recommends per-game; we do per-game updates, so a "period" is purely
 * the unit `c` is expressed in and the unit elapsed inactivity is measured in.
 */
export const RATING_PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * Glicko-1's system constant `c`, in rating points per daily period, added in
 * quadrature: `RD ← min(sqrt(RD² + c²·t), 350)`.
 *
 * 15 was chosen from the inactivity simulation: a settled RD-60 player reaches RD 102
 * after 30 days (still leaderboard-eligible, so a returning player re-qualifies with
 * a single match), crosses the RD-150 gate at ~84 days, and returns to the maximum
 * RD 350 after roughly 530 days. Glickman's own worked value of ~34.6 assumes a
 * rating period is a tournament or a month, not a day, and at daily periods it would
 * disqualify a player for a single month away.
 *
 * The value is meaningless without RATING_PERIOD_MS: changing one requires rescaling
 * the other, which is why they live side by side.
 */
export const GLICKO_SYSTEM_CONSTANT = 15;

/** Spec §7.7 requires a minimum games-played threshold; this is the chosen number. */
export const LEADERBOARD_MIN_RATED_GAMES = 10;

/**
 * Spec §7.7 requires a maximum-RD threshold; this is the chosen number, and the
 * comparison is strict (`rd < 150`, not `<=`).
 *
 * It pairs closely with the games threshold: a player whose opponents are all new
 * (RD 350) reaches RD ≈ 149.7 at exactly their tenth rated game, and one playing a
 * settled pool gets there sooner. So the two gates agree for a typical player, and
 * the RD gate is what catches a player whose games were all heavy mismatches and
 * therefore taught the system less.
 */
export const LEADERBOARD_MAX_RD = 150;

/**
 * How long since a player's last rated match before they drop off the active
 * leaderboard. Nothing is deleted — rating, profile and history are untouched, and
 * one rated match puts an eligible player straight back on.
 */
export const LEADERBOARD_INACTIVITY_DAYS = 30;

/**
 * What RD inflation needs: a deviation, and when it was last recalculated.
 *
 * Split from `RatingActivity` so the rating processor — which has a player's RD and
 * stamp but no interest in their games played — can inflate without inventing a
 * field.
 */
export interface InflatableRd {
  readonly rd: number;
  /** Null for a row that has never been through a rated match. */
  readonly lastRatingPeriodAt: Date | null;
}

/** What leaderboard eligibility needs: the above, plus the games-played count. */
export interface RatingActivity extends InflatableRd {
  readonly gamesRated: number;
}

/**
 * Rating periods elapsed since a player's last rated match, as a fraction.
 *
 * Fractional rather than whole days on purpose: `inflateRd` is continuous in `t`, so
 * a fraction avoids a step at midnight, stays monotonic, and is still exactly
 * reproducible from the two stored timestamps.
 *
 * Returns 0 for a player who has never been rated (no stamp means no measurable
 * elapsed time) and for a reference instant that precedes the stamp, which clock skew
 * between the app and the database can produce.
 */
export function elapsedRatingPeriods(lastRatingPeriodAt: Date | null, now: Date): number {
  if (lastRatingPeriodAt === null) {
    return 0;
  }
  const elapsed = (now.getTime() - lastRatingPeriodAt.getTime()) / RATING_PERIOD_MS;
  return elapsed > 0 ? elapsed : 0;
}

/**
 * A player's RD as of `now`, with spec §7.6's inactivity growth applied.
 *
 * This is the number every decision should use. The stored `rd` is only correct as of
 * the player's last rated match; for anyone who has been away it understates their
 * uncertainty, and §7.6's lazy-inflation approach means nothing ever writes the
 * corrected value until they play again.
 */
export function currentRd(state: InflatableRd, now: Date): number {
  return inflateRd(
    state.rd,
    GLICKO_SYSTEM_CONSTANT,
    elapsedRatingPeriods(state.lastRatingPeriodAt, now),
  );
}

export type LeaderboardExclusion =
  /** No rated match yet, so there is nothing to rank. */
  | 'never_rated'
  /** Spec §7.7's minimum games-played gate. */
  | 'too_few_games'
  /** Spec §7.7's maximum-RD gate, measured against the *inflated* RD. */
  | 'rating_too_uncertain'
  /** Away longer than LEADERBOARD_INACTIVITY_DAYS. */
  | 'inactive';

export type LeaderboardEligibility =
  { readonly eligible: true } | { readonly eligible: false; readonly reason: LeaderboardExclusion };

/**
 * Whether a player belongs on the active leaderboard (spec §7.7).
 *
 * Checked in order of how fundamental the exclusion is, so an excluded player can be
 * told the most useful thing: "play N more games" beats "your rating is uncertain"
 * when both are true.
 *
 * `leaderboard.ts` carries the same decision as a SQL predicate for the ranked query;
 * this one is for a single player — their own "around me" row, a profile badge, or a
 * test. The two must agree, and the SQL is written as a direct transcription of this.
 */
export function leaderboardEligibility(state: RatingActivity, now: Date): LeaderboardEligibility {
  if (state.lastRatingPeriodAt === null) {
    return { eligible: false, reason: 'never_rated' };
  }
  if (state.gamesRated < LEADERBOARD_MIN_RATED_GAMES) {
    return { eligible: false, reason: 'too_few_games' };
  }
  if (elapsedRatingPeriods(state.lastRatingPeriodAt, now) >= LEADERBOARD_INACTIVITY_DAYS) {
    return { eligible: false, reason: 'inactive' };
  }
  if (currentRd(state, now) >= LEADERBOARD_MAX_RD) {
    return { eligible: false, reason: 'rating_too_uncertain' };
  }
  return { eligible: true };
}

/** `leaderboardEligibility` when only the yes/no matters. */
export function isLeaderboardEligible(state: RatingActivity, now: Date): boolean {
  return leaderboardEligibility(state, now).eligible;
}

/** Re-exported so callers reading this policy do not have to reach into the math. */
export { MAX_RD };
