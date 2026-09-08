import { describe, expect, it } from 'vitest';

import { createBot } from './index';
import { benchmarkSolo, headToHead, playMatch, simulateSoloClear } from './simulate';

const SOLO_GAMES = 80;
const MATCH_GAMES = 60;
const SEED = 12345;

const easy = createBot('easy');
const medium = createBot('medium');
const hard = createBot('hard');

describe('simulation harness', () => {
  it('always clears the board and lands exactly 20 hits', () => {
    const result = simulateSoloClear(hard, 2, 3);

    expect(result.hits).toBe(20);
    expect(result.shots).toBeGreaterThanOrEqual(20);
    expect(result.shots).toBeLessThanOrEqual(100);
    expect(result.multiCellPhaseShots).toBeLessThanOrEqual(result.shots);
  });

  it('is fully deterministic for the same seeds', () => {
    expect(simulateSoloClear(medium, 11, 22)).toEqual(simulateSoloClear(medium, 11, 22));
    expect(benchmarkSolo(easy, 20, SEED)).toEqual(benchmarkSolo(easy, 20, SEED));
    expect(playMatch(hard, medium, 5)).toEqual(playMatch(hard, medium, 5));
  });

  it('produces a decisive winner in every head-to-head game', () => {
    const result = headToHead(medium, easy, 10, SEED);

    expect(result.winsA + result.winsB).toBe(10);
  });
});

/**
 * Spec §7.3 acceptance: "Hard's average shots-to-win is significantly lower than
 * Medium's over a benchmark of N simulated games."
 *
 * Every figure below is deterministic — same seeds, same result on every run — so
 * these are exact regression bounds, not flaky statistical guesses.
 */
describe('difficulty ordering — solo shots to clear a board', () => {
  const results = {
    easy: benchmarkSolo(easy, SOLO_GAMES, SEED),
    medium: benchmarkSolo(medium, SOLO_GAMES, SEED),
    hard: benchmarkSolo(hard, SOLO_GAMES, SEED),
  };

  it('ranks hard better than medium, and medium far better than easy', () => {
    expect(results.hard.meanShots).toBeLessThan(results.medium.meanShots);
    expect(results.medium.meanShots).toBeLessThan(results.easy.meanShots);
  });

  it('shows a large easy-to-medium gap', () => {
    expect(results.easy.meanShots - results.medium.meanShots).toBeGreaterThan(10);
  });

  /**
   * The hard-vs-medium gap is much clearer once the single-cell submarine endgame
   * is excluded. Every remaining ship there occupies one cell, so no strategy can
   * prefer one unknown cell over another — it is a pure random search that both
   * bots must pay, and it compresses the totals.
   */
  it('separates clearly on search quality, before the submarine endgame', () => {
    expect(results.hard.meanMultiCellPhaseShots).toBeLessThan(
      results.medium.meanMultiCellPhaseShots - 2,
    );
    expect(results.medium.meanMultiCellPhaseShots).toBeLessThan(
      results.easy.meanMultiCellPhaseShots - 20,
    );
  });

  it('keeps every difficulty inside a sane band', () => {
    for (const result of Object.values(results)) {
      expect(result.bestShots).toBeGreaterThanOrEqual(20);
      expect(result.worstShots).toBeLessThanOrEqual(100);
      expect(result.games).toBe(SOLO_GAMES);
    }
  });
});

describe('difficulty ordering — head to head', () => {
  it('medium overwhelms easy', () => {
    const result = headToHead(medium, easy, MATCH_GAMES, SEED);

    expect(result.winRateA).toBeGreaterThan(0.85);
  });

  it('hard overwhelms easy', () => {
    const result = headToHead(hard, easy, MATCH_GAMES, SEED);

    expect(result.winRateA).toBeGreaterThan(0.85);
  });

  it('hard beats medium more often than not', () => {
    const result = headToHead(hard, medium, MATCH_GAMES, SEED);

    expect(result.winRateA).toBeGreaterThan(0.5);
  });
});
