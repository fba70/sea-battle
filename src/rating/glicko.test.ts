import { describe, expect, it } from 'vitest';

import {
  expectedScore,
  g,
  inflateRd,
  rateHeadToHead,
  updateRating,
  DEFAULT_RATING,
  DEFAULT_RD,
  GLICKO_Q,
  INITIAL_RATING,
  MAX_RD,
  SCORE,
  type GlickoRating,
} from './glicko';

/**
 * Glickman's worked example (the Glicko-1 paper, "Example calculation"), which spec
 * §7.6's acceptance criteria require as a test: a player at 1500/200 plays three
 * opponents in one rating period — beats 1400/30, loses to 1550/100, loses to
 * 1700/300 — and ends at 1464.1 with RD 151.4.
 */
const PAPER_PLAYER: GlickoRating = { rating: 1500, rd: 200 };
const PAPER_RESULTS = [
  { opponent: { rating: 1400, rd: 30 }, score: SCORE.win },
  { opponent: { rating: 1550, rd: 100 }, score: SCORE.loss },
  { opponent: { rating: 1700, rd: 300 }, score: SCORE.loss },
] as const;

describe("Glickman's worked example (spec §7.6)", () => {
  it('reproduces the published g(RD) values', () => {
    expect(g(30)).toBeCloseTo(0.9955, 4);
    expect(g(100)).toBeCloseTo(0.9531, 4);
    expect(g(300)).toBeCloseTo(0.7242, 4);
  });

  it('reproduces the published expected scores', () => {
    expect(expectedScore(PAPER_PLAYER, { rating: 1400, rd: 30 })).toBeCloseTo(0.639, 3);
    expect(expectedScore(PAPER_PLAYER, { rating: 1550, rd: 100 })).toBeCloseTo(0.432, 3);
    expect(expectedScore(PAPER_PLAYER, { rating: 1700, rd: 300 })).toBeCloseTo(0.303, 3);
  });

  it('reproduces the published new rating and deviation', () => {
    const updated = updateRating(PAPER_PLAYER, PAPER_RESULTS);

    expect(updated.rating).toBeCloseTo(1464.1, 1);
    expect(updated.rd).toBeCloseTo(151.4, 1);
  });

  it('uses the constant spec §7.6 specifies', () => {
    expect(GLICKO_Q).toBeCloseTo(0.0057565, 7);
    expect(GLICKO_Q).toBe(Math.LN10 / 400);
  });
});

describe('g(RD)', () => {
  it('approaches 1 as the opponent rating becomes certain', () => {
    expect(g(0)).toBe(1);
    expect(g(1)).toBeCloseTo(1, 4);
  });

  it('shrinks as the opponent rating becomes less certain', () => {
    expect(g(350)).toBeLessThan(g(100));
    expect(g(100)).toBeLessThan(g(30));
  });
});

describe('expectedScore', () => {
  it('is even between identical players', () => {
    expect(expectedScore(INITIAL_RATING, INITIAL_RATING)).toBeCloseTo(0.5, 10);
  });

  it('favours the higher-rated player, and the two sides sum to one', () => {
    const strong: GlickoRating = { rating: 1800, rd: 50 };
    const weak: GlickoRating = { rating: 1400, rd: 50 };

    expect(expectedScore(strong, weak)).toBeGreaterThan(0.5);
    expect(expectedScore(strong, weak) + expectedScore(weak, strong)).toBeCloseTo(1, 10);
  });

  it('stays a probability across extreme gaps', () => {
    const gulf = expectedScore({ rating: 3000, rd: 30 }, { rating: 100, rd: 30 });
    expect(gulf).toBeGreaterThan(0);
    expect(gulf).toBeLessThanOrEqual(1);
  });
});

describe('a new player (spec §7.6 acceptance criteria)', () => {
  it('starts at 1500 with RD 350', () => {
    expect(INITIAL_RATING).toEqual({ rating: DEFAULT_RATING, rd: DEFAULT_RD });
  });

  it('has their RD shrink as they play', () => {
    let player = INITIAL_RATING;
    const opponent: GlickoRating = { rating: 1500, rd: 50 };
    const deviations: number[] = [player.rd];

    for (let game = 0; game < 5; game += 1) {
      player = updateRating(player, [{ opponent, score: SCORE.win }]);
      deviations.push(player.rd);
    }

    for (let index = 1; index < deviations.length; index += 1) {
      expect(deviations[index]).toBeLessThan(deviations[index - 1] as number);
    }
  });

  it('moves further per game than a settled player does', () => {
    // High RD means low confidence, so the rating is allowed to move fast.
    const provisional = rateHeadToHead(INITIAL_RATING, { rating: 1500, rd: 50 }, SCORE.win);
    const settled = rateHeadToHead({ rating: 1500, rd: 50 }, { rating: 1500, rd: 50 }, SCORE.win);

    expect(provisional.deltaA).toBeGreaterThan(settled.deltaA);
  });
});

describe('winners gain and losers lose (spec §7.6 acceptance criteria)', () => {
  const peer: GlickoRating = { rating: 1500, rd: 60 };

  it('moves the winner up and the loser down', () => {
    const result = rateHeadToHead(peer, peer, SCORE.win);

    expect(result.deltaA).toBeGreaterThan(0);
    expect(result.deltaB).toBeLessThan(0);
    expect(result.a.rating).toBeGreaterThan(peer.rating);
    expect(result.b.rating).toBeLessThan(peer.rating);
  });

  it('rewards beating a much higher-rated opponent more than beating a peer', () => {
    const underdog: GlickoRating = { rating: 1500, rd: 60 };
    const upset = rateHeadToHead(underdog, { rating: 1900, rd: 60 }, SCORE.win);
    const routine = rateHeadToHead(underdog, peer, SCORE.win);

    expect(upset.deltaA).toBeGreaterThan(routine.deltaA);
  });

  it('punishes losing to a much lower-rated opponent more than losing to a peer', () => {
    const favourite: GlickoRating = { rating: 1900, rd: 60 };
    const upset = rateHeadToHead(favourite, { rating: 1500, rd: 60 }, SCORE.loss);
    const routine = rateHeadToHead(favourite, { rating: 1900, rd: 60 }, SCORE.loss);

    expect(upset.deltaA).toBeLessThan(routine.deltaA);
  });

  it('shrinks both players RD, whoever won', () => {
    const result = rateHeadToHead(peer, peer, SCORE.win);

    expect(result.a.rd).toBeLessThan(peer.rd);
    expect(result.b.rd).toBeLessThan(peer.rd);
  });

  it('barely moves a heavy favourite who wins as expected', () => {
    const expectedWin = rateHeadToHead(
      { rating: 2200, rd: 40 },
      { rating: 1200, rd: 40 },
      SCORE.win,
    );

    expect(expectedWin.deltaA).toBeGreaterThan(0);
    expect(expectedWin.deltaA).toBeLessThan(2);
  });

  it('supports the draw Glicko defines, even though Classic cannot produce one', () => {
    const drawn = rateHeadToHead({ rating: 1600, rd: 60 }, { rating: 1400, rd: 60 }, SCORE.draw);

    // The higher-rated player under-performed a draw, so loses a little.
    expect(drawn.deltaA).toBeLessThan(0);
    expect(drawn.deltaB).toBeGreaterThan(0);
  });
});

describe('rateHeadToHead computes both sides from the same pre-match state', () => {
  it('does not feed the winner updated rating into the loser calculation', () => {
    const a: GlickoRating = { rating: 1500, rd: 80 };
    const b: GlickoRating = { rating: 1700, rd: 120 };

    const paired = rateHeadToHead(a, b, SCORE.win);

    // Computing each side independently from the same snapshot must agree exactly.
    expect(paired.a).toEqual(updateRating(a, [{ opponent: b, score: SCORE.win }]));
    expect(paired.b).toEqual(updateRating(b, [{ opponent: a, score: SCORE.loss }]));
  });

  it('is symmetric: swapping seats mirrors the outcome', () => {
    const a: GlickoRating = { rating: 1480, rd: 90 };
    const b: GlickoRating = { rating: 1620, rd: 70 };

    const aWins = rateHeadToHead(a, b, SCORE.win);
    const swapped = rateHeadToHead(b, a, SCORE.loss);

    expect(swapped.b.rating).toBeCloseTo(aWins.a.rating, 10);
    expect(swapped.a.rating).toBeCloseTo(aWins.b.rating, 10);
  });

  it('reports deltas that match the new ratings exactly', () => {
    const a: GlickoRating = { rating: 1523.5, rd: 143.2 };
    const b: GlickoRating = { rating: 1611.9, rd: 88.4 };
    const result = rateHeadToHead(a, b, SCORE.loss);

    expect(result.deltaA).toBeCloseTo(result.a.rating - a.rating, 12);
    expect(result.deltaB).toBeCloseTo(result.b.rating - b.rating, 12);
  });

  it('is deterministic — no clock, no randomness', () => {
    const a: GlickoRating = { rating: 1512.34, rd: 211.7 };
    const b: GlickoRating = { rating: 1489.01, rd: 95.2 };

    expect(rateHeadToHead(a, b, SCORE.win)).toEqual(rateHeadToHead(a, b, SCORE.win));
  });

  it('never mutates its inputs', () => {
    const a: GlickoRating = { rating: 1500, rd: 200 };
    const b: GlickoRating = { rating: 1600, rd: 100 };
    rateHeadToHead(a, b, SCORE.win);

    expect(a).toEqual({ rating: 1500, rd: 200 });
    expect(b).toEqual({ rating: 1600, rd: 100 });
  });
});

describe('results stay finite and usable', () => {
  const CASES: readonly [string, GlickoRating, GlickoRating][] = [
    ['two brand-new players', INITIAL_RATING, INITIAL_RATING],
    ['a settled pair', { rating: 1500, rd: 30 }, { rating: 1500, rd: 30 }],
    ['an extreme gap', { rating: 2800, rd: 30 }, { rating: 200, rd: 350 }],
    ['a tiny deviation', { rating: 1500, rd: 0.5 }, { rating: 1500, rd: 350 }],
  ];

  for (const [label, a, b] of CASES) {
    for (const score of [SCORE.win, SCORE.loss] as const) {
      it(`${label}: produces finite, positive-RD results (score ${score})`, () => {
        const result = rateHeadToHead(a, b, score);

        for (const side of [result.a, result.b]) {
          expect(Number.isFinite(side.rating)).toBe(true);
          expect(Number.isFinite(side.rd)).toBe(true);
          expect(side.rd).toBeGreaterThan(0);
        }
        // A game can only reduce uncertainty.
        expect(result.a.rd).toBeLessThanOrEqual(a.rd);
        expect(result.b.rd).toBeLessThanOrEqual(b.rd);
      });
    }
  }

  it('rejects a non-finite rating rather than producing NaN', () => {
    expect(() =>
      rateHeadToHead({ rating: Number.NaN, rd: 100 }, INITIAL_RATING, SCORE.win),
    ).toThrow(RangeError);
    expect(() =>
      rateHeadToHead({ rating: 1500, rd: Number.POSITIVE_INFINITY }, INITIAL_RATING, SCORE.win),
    ).toThrow(RangeError);
  });

  it('rejects a zero or negative deviation, which would divide by zero', () => {
    expect(() => rateHeadToHead({ rating: 1500, rd: 0 }, INITIAL_RATING, SCORE.win)).toThrow(
      RangeError,
    );
    expect(() => rateHeadToHead({ rating: 1500, rd: -5 }, INITIAL_RATING, SCORE.win)).toThrow(
      RangeError,
    );
  });

  it('leaves a rating untouched for a period with no games', () => {
    expect(updateRating(PAPER_PLAYER, [])).toEqual(PAPER_PLAYER);
  });
});

describe('inflateRd (spec §7.6 RD growth over inactivity)', () => {
  // `c` is explicitly unresolved in §7.6, so these tests pass one in rather than
  // relying on a default — there is none to rely on.
  const C = 30;

  it('grows RD with elapsed periods', () => {
    expect(inflateRd(50, C, 1)).toBeCloseTo(Math.sqrt(50 ** 2 + C ** 2), 10);
    expect(inflateRd(50, C, 4)).toBeGreaterThan(inflateRd(50, C, 1));
  });

  it('never exceeds the 350 ceiling', () => {
    expect(inflateRd(300, C, 10_000)).toBe(MAX_RD);
    expect(inflateRd(MAX_RD, C, 1)).toBe(MAX_RD);
  });

  it('leaves RD alone when no time has passed', () => {
    expect(inflateRd(120, C, 0)).toBe(120);
    expect(inflateRd(120, C, -3)).toBe(120);
  });

  it('requires the constant to be supplied, so none can be silently inherited', () => {
    // A missing `c` is a type error at compile time; a nonsense one fails loudly.
    expect(() => inflateRd(100, Number.NaN, 1)).toThrow(RangeError);
  });
});
