import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { MAX_RD } from '@/rating/glicko';

import { inflatedRdSql, leaderboardEligibleSql } from './leaderboard';
import {
  GLICKO_SYSTEM_CONSTANT,
  LEADERBOARD_INACTIVITY_DAYS,
  LEADERBOARD_MAX_RD,
  LEADERBOARD_MIN_RATED_GAMES,
  RATING_PERIOD_MS,
} from './policy';

/**
 * Pins the SQL the leaderboard filter emits, without a database.
 *
 * The point of these assertions is that the predicate stays a transcription of
 * `policy.ts`: every threshold must arrive as a bound parameter taken from those
 * constants, so changing a product decision in one place cannot leave the ranked
 * query behind on the old number.
 */
const dialect = new PgDialect();
const NOW = new Date('2026-10-18T09:00:00Z');

const render = (query: Parameters<PgDialect['sqlToQuery']>[0]) => dialect.sqlToQuery(query);

describe('inflatedRdSql transcribes spec §7.6 growth', () => {
  const { sql, params } = render(inflatedRdSql(NOW));

  it('is min(sqrt(RD² + c²·t), 350)', () => {
    // The squaring exponents are literal 2s; every tuned value is a parameter.
    expect(sql).toMatch(/least\(sqrt\(power\("ratings"\."rd", 2\) \+ power\(\$\d+, 2\)/);
    expect(sql).toContain('extract(epoch from');
  });

  it('takes c, the period length and the RD ceiling from the policy module', () => {
    expect(params).toContain(GLICKO_SYSTEM_CONSTANT);
    expect(params).toContain(RATING_PERIOD_MS / 1000);
    expect(params).toContain(MAX_RD);
  });

  it('measures elapsed time against the instant it was given, as a parameter', () => {
    expect(params).toContain(NOW.toISOString());
    // Nothing is interpolated into the statement text.
    expect(sql).not.toContain('2026-10-18');
  });

  it('treats a never-rated row as zero elapsed periods and clamps clock skew', () => {
    expect(sql).toContain('coalesce(');
    expect(sql).toContain('greatest(');
  });
});

describe('leaderboardEligibleSql matches the policy decision', () => {
  const { sql, params } = render(leaderboardEligibleSql(NOW));

  it('requires a rated match to have happened', () => {
    expect(sql).toContain('"ratings"."last_rating_period_at" is not null');
  });

  it('applies the minimum games gate inclusively', () => {
    expect(sql).toMatch(/"ratings"\."games_rated" >= \$\d+/);
    expect(params).toContain(LEADERBOARD_MIN_RATED_GAMES);
  });

  it('applies the inactivity window and the RD ceiling strictly', () => {
    // Both are `<`: a player exactly at the threshold is excluded, as in `policy.ts`.
    expect(params).toContain(LEADERBOARD_INACTIVITY_DAYS);
    expect(params).toContain(LEADERBOARD_MAX_RD);
    expect(sql).not.toContain('<=');
  });

  it('filters on the inflated RD, never the stored column alone', () => {
    // The staleness bug this exists to prevent: `rd < 150` would rank a player whose
    // RD has grown past the gate while they were away.
    expect(sql).not.toMatch(/"ratings"\."rd" </);
    expect(sql).toMatch(/least\(sqrt\(.+\) < \$\d+/s);
  });

  it('parameterises every threshold — nothing is interpolated', () => {
    expect(sql).not.toMatch(/\b(150|350|30|10)\b/);
  });
});
