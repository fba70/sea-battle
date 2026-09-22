/**
 * Rating processing (spec §7.6).
 *
 * The Glicko-1 math itself is in `src/rating/glicko.ts` — pure, dependency-free and
 * tested against Glickman's worked example. This directory is the part that touches
 * the database: it reads the authoritative `games` row, decides whether the game may
 * move ratings at all (spec §4), and applies the result exactly once.
 *
 * Nothing calls `processFinishedGame` yet. The live game loop that ends a rated game
 * and triggers this is a later block; this one supplies the machinery.
 *
 * Still undecided, and deliberately absent: the inactivity constant `c`, the rating
 * period length, and the provisional/leaderboard thresholds. §7.6 leaves all three to
 * tuning, so RD inflation is implemented (`inflateRd`) but not wired in, and
 * `last_rating_period_at` is recorded so elapsed time stays recoverable.
 */
export * from './eligibility';
export * from './process';
export * from './rating-store';
