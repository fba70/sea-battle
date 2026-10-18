/**
 * Rating processing (spec §7.6).
 *
 * The Glicko-1 math itself is in `src/rating/glicko.ts` — pure, dependency-free and
 * tested against Glickman's worked example. This directory is the part that touches
 * the database: it reads the authoritative `games` row, decides whether the game may
 * move ratings at all (spec §4), and applies the result exactly once.
 *
 * `processFinishedGame` is driven by the Worker's result report, through
 * `src/app/api/game/result/route.ts`.
 *
 * The numbers §7.6 and §7.7 leave to tuning — the inactivity constant `c`, the rating
 * period length, and the minimum-games / maximum-RD leaderboard thresholds — are
 * product decisions and live in `policy.ts`, which is also where RD inflation and
 * leaderboard eligibility are decided. `leaderboard.ts` carries the same eligibility
 * rule as a SQL predicate for the ranked read.
 */
export * from './eligibility';
export * from './leaderboard';
export * from './policy';
export * from './process';
export * from './rating-store';
