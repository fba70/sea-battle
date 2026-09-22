/**
 * Glicko-1, exactly as spec §7.6 transcribes it from Glickman's paper.
 *
 * INVARIANT: this module is pure and dependency-free — no database, no transport, no
 * framework, no clock, no randomness. It is the rating counterpart of `src/game`, and
 * for the same reason: the math must be testable on its own and reusable by whatever
 * calls it. The code that reads games and writes rows lives in `src/lib/rating`.
 *
 * What is deliberately NOT here: the rating-period policy, the inactivity constant `c`,
 * and the provisional/leaderboard thresholds. §7.6 leaves all three open, so
 * `inflateRd` takes `c` as an argument rather than picking one, and nothing in this
 * module decides when a rating period begins or ends.
 */

/** Spec §7.6: `q = ln(10)/400`. */
export const GLICKO_Q = Math.LN10 / 400;

/** Spec §6 and §7.6: a new player starts here. */
export const DEFAULT_RATING = 1500;

/**
 * Spec §6 and §7.6: maximum uncertainty, and the starting value for a new player.
 * Also the ceiling RD is clamped to when inactivity inflates it.
 */
export const DEFAULT_RD = 350;
export const MAX_RD = DEFAULT_RD;

/** Spec §7.6: `s ∈ {1, 0.5, 0}`. Classic has no draws, but Glicko-1 defines one. */
export const SCORE = { win: 1, draw: 0.5, loss: 0 } as const;
export type GlickoScore = (typeof SCORE)[keyof typeof SCORE];

export interface GlickoRating {
  readonly rating: number;
  /** Rating deviation: how uncertain the rating is. */
  readonly rd: number;
}

export interface GlickoOpponentResult {
  readonly opponent: GlickoRating;
  readonly score: GlickoScore;
}

export const INITIAL_RATING: GlickoRating = { rating: DEFAULT_RATING, rd: DEFAULT_RD };

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number, got ${String(value)}`);
  }
}

function assertRating(rating: GlickoRating, label: string): void {
  assertFinite(rating.rating, `${label}.rating`);
  assertFinite(rating.rd, `${label}.rd`);
  if (rating.rd <= 0) {
    // RD of zero would divide by zero in the update; Glicko keeps it strictly positive.
    throw new RangeError(`${label}.rd must be greater than zero, got ${rating.rd}`);
  }
}

/**
 * Spec §7.6: `g(RD) = 1 / sqrt(1 + 3·q²·RD² / π²)`.
 *
 * Weighs an opponent's contribution by how well known their rating is — a result
 * against a player with a huge RD says less than one against a settled rating.
 */
export function g(rd: number): number {
  assertFinite(rd, 'rd');
  return 1 / Math.sqrt(1 + (3 * GLICKO_Q ** 2 * rd ** 2) / Math.PI ** 2);
}

/**
 * Spec §7.6: `E = 1 / (1 + 10^(−g(RD_opp)·(r − r_opp)/400))`.
 *
 * The probability `player` scores against `opponent`.
 */
export function expectedScore(player: GlickoRating, opponent: GlickoRating): number {
  assertRating(player, 'player');
  assertRating(opponent, 'opponent');
  return 1 / (1 + 10 ** ((-g(opponent.rd) * (player.rating - opponent.rating)) / 400));
}

/**
 * One Glicko-1 rating period for a single player.
 *
 * Spec §7.6:
 *   `d² = 1 / (q² · Σ g(RD_j)² · E_j · (1 − E_j))`
 *   `r' = r + (q / (1/RD² + 1/d²)) · Σ g(RD_j)·(s_j − E_j)`
 *   `RD' = sqrt(1 / (1/RD² + 1/d²))`
 *
 * Written for a set of results because that is the form Glickman's worked example
 * uses, so the paper's numbers are a direct test. A per-game ladder (§7.6's
 * recommendation) simply passes a single result — see `rateHeadToHead`.
 *
 * A period with no games leaves the rating untouched: RD growth over inactivity is
 * `inflateRd`'s job, and it needs a constant this module refuses to invent.
 */
export function updateRating(
  player: GlickoRating,
  results: readonly GlickoOpponentResult[],
): GlickoRating {
  assertRating(player, 'player');

  if (results.length === 0) {
    return { rating: player.rating, rd: player.rd };
  }

  let inverseDSquared = 0;
  let scoreDelta = 0;

  for (const [index, result] of results.entries()) {
    assertRating(result.opponent, `results[${index}].opponent`);

    const gOpponent = g(result.opponent.rd);
    const expected = expectedScore(player, result.opponent);

    inverseDSquared += GLICKO_Q ** 2 * gOpponent ** 2 * expected * (1 - expected);
    scoreDelta += gOpponent * (result.score - expected);
  }

  const denominator = 1 / player.rd ** 2 + inverseDSquared;

  return {
    rating: player.rating + (GLICKO_Q / denominator) * scoreDelta,
    rd: Math.sqrt(1 / denominator),
  };
}

/**
 * Spec §7.6: `RD ← min(sqrt(RD² + c²·t), 350)`.
 *
 * `systemConstant` is `c`, which §7.6 leaves to tuning ("c is tuned so an
 * unrated-length inactivity returns RD to ~350 over a chosen span"). It is a required
 * argument precisely so no caller can silently inherit a made-up value, and nothing in
 * SeaDuel calls this yet — see `src/lib/rating`.
 */
export function inflateRd(rd: number, systemConstant: number, elapsedPeriods: number): number {
  assertFinite(rd, 'rd');
  assertFinite(systemConstant, 'systemConstant');
  assertFinite(elapsedPeriods, 'elapsedPeriods');

  if (elapsedPeriods <= 0) {
    return Math.min(rd, MAX_RD);
  }

  return Math.min(Math.sqrt(rd ** 2 + systemConstant ** 2 * elapsedPeriods), MAX_RD);
}

export interface HeadToHeadResult {
  readonly a: GlickoRating;
  readonly b: GlickoRating;
  readonly deltaA: number;
  readonly deltaB: number;
}

/**
 * Rates one game between two players (§7.6's recommended per-game update).
 *
 * Both sides are computed from the *same* pre-match snapshot — `b`'s new rating uses
 * `a`'s rating as it was before this game, not after. Doing it in one function makes
 * that structural rather than a rule a caller has to remember.
 */
export function rateHeadToHead(
  a: GlickoRating,
  b: GlickoRating,
  scoreForA: GlickoScore,
): HeadToHeadResult {
  assertRating(a, 'a');
  assertRating(b, 'b');

  const scoreForB = (1 - scoreForA) as GlickoScore;

  const nextA = updateRating(a, [{ opponent: b, score: scoreForA }]);
  const nextB = updateRating(b, [{ opponent: a, score: scoreForB }]);

  return {
    a: nextA,
    b: nextB,
    deltaA: nextA.rating - a.rating,
    deltaB: nextB.rating - b.rating,
  };
}
