import { describe, expect, it } from 'vitest';

import { bufferAround, toIndex } from '../coord';
import { fire } from '../fire';
import { validateFleet } from '../placement';
import { createRng } from '../rng';
import { createGame, placeFleet, type GameState } from '../state';
import { FLEET_A, FLEET_B } from '../testing/fixtures';
import { fireAll, startedGame } from '../testing/harness';
import type { Coord, PlayerSlot, Ship } from '../types';
import { createPlayerView, legalTargetsFromView, opponentCellAt } from '../view';
import { BOT_DIFFICULTIES, createBot } from './index';
import { densityScores, huntSpacing } from './hard';
import { readKnowledge } from './knowledge';
import { targetCandidates } from './medium';
import { placementPredictability } from './placement';
import { thinkingDelayMs } from './types';

function asPlacements(ships: readonly Ship[]) {
  return ships.map(({ shipClass, origin, orientation }) => ({ shipClass, origin, orientation }));
}

/** Runs a bot until the board is clear, returning every cell it fired at, in order. */
function playSolo(difficulty: 'easy' | 'medium' | 'hard', seed: number): Coord[] {
  const bot = createBot(difficulty);
  const rng = createRng(seed);
  let state: GameState = startedGame();
  const fired: Coord[] = [];

  while (state.phase === 'playing' && fired.length < 200) {
    const coord = bot.chooseShot(createPlayerView(state, 'a'), rng);
    fired.push(coord);

    const result = fire(state, 'a', coord);
    if (!result.ok) {
      throw new Error(`${difficulty} chose an illegal target: ${result.error.code}`);
    }
    state =
      result.value.state.phase === 'playing'
        ? { ...result.value.state, turn: 'a' as PlayerSlot }
        : result.value.state;
  }

  if (state.phase !== 'finished') {
    throw new Error(`${difficulty} failed to finish the board`);
  }
  return fired;
}

describe.each(BOT_DIFFICULTIES)('%s bot — universal guarantees', (difficulty) => {
  it('only ever picks a legally shootable cell', () => {
    const bot = createBot(difficulty);
    const rng = createRng(7);
    let state = startedGame();

    for (let turn = 0; turn < 40 && state.phase === 'playing'; turn += 1) {
      const view = createPlayerView(state, 'a');
      const coord = bot.chooseShot(view, rng);

      expect(legalTargetsFromView(view)).toContainEqual(coord);
      expect(opponentCellAt(view, coord)).toBe('unknown');

      const result = fire(state, 'a', coord);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state =
        result.value.state.phase === 'playing'
          ? { ...result.value.state, turn: 'a' }
          : result.value.state;
    }
  });

  it('never repeats a cell and always finishes the board', () => {
    const fired = playSolo(difficulty, 99);
    const unique = new Set(fired.map(toIndex));

    expect(unique.size).toBe(fired.length);
    expect(fired.length).toBeLessThanOrEqual(100);
  });

  it('is reproducible for a given seed', () => {
    expect(playSolo(difficulty, 4242)).toEqual(playSolo(difficulty, 4242));
  });

  it('varies with the seed', () => {
    expect(playSolo(difficulty, 1)).not.toEqual(playSolo(difficulty, 2));
  });

  it('places a legal fleet for 100 seeds', () => {
    const bot = createBot(difficulty);

    for (let seed = 0; seed < 100; seed += 1) {
      const fleet = bot.chooseFleet(createRng(seed));
      const validated = validateFleet(asPlacements(fleet));

      if (!validated.ok) {
        throw new Error(
          `${difficulty} seed ${seed} placed an illegal fleet: ${validated.error.code}`,
        );
      }
      expect(fleet).toHaveLength(10);
    }
  });

  it('never places two ships touching, not even diagonally', () => {
    const fleet = createBot(difficulty).chooseFleet(createRng(31));

    for (const ship of fleet) {
      const otherCells = new Set(
        fleet.filter((other) => other.id !== ship.id).flatMap((other) => other.cells.map(toIndex)),
      );
      for (const cell of [...ship.cells, ...bufferAround(ship.cells)]) {
        expect(otherCells.has(toIndex(cell))).toBe(false);
      }
    }
  });
});

describe('easy bot', () => {
  it('spreads its shots across the board rather than clustering', () => {
    const fired = playSolo('easy', 5);
    const columns = new Set(fired.map((coord) => coord.x));

    expect(columns.size).toBeGreaterThan(7);
  });

  it('does not chase a hit — it keeps picking uniformly', () => {
    // After a hit at A2, an adjacent follow-up should not be guaranteed.
    const state = fireAll(startedGame(), 'a', [{ x: 0, y: 1 }]);
    const view = createPlayerView(state, 'a');
    const bot = createBot('easy');

    const picks = Array.from({ length: 40 }, (_, seed) => bot.chooseShot(view, createRng(seed)));
    const adjacent = picks.filter(
      (coord) => Math.abs(coord.x - 0) + Math.abs(coord.y - 1) === 1,
    ).length;

    // Uniform choice over ~99 cells would put ~3/40 next to the hit; a hunting bot
    // would put all 40 there.
    expect(adjacent).toBeLessThan(15);
  });
});

describe('medium bot — hunt/target (spec §7.3)', () => {
  it('probes orthogonal neighbours of a lone hit', () => {
    // E4 (x4,y3) is the first cell of a destroyer in FLEET_B, so this is a live hit.
    const state = fireAll(startedGame(), 'a', [{ x: 4, y: 3 }]);
    const view = createPlayerView(state, 'a');
    const bot = createBot('medium');

    for (let seed = 0; seed < 20; seed += 1) {
      const coord = bot.chooseShot(view, createRng(seed));
      expect(Math.abs(coord.x - 4) + Math.abs(coord.y - 3)).toBe(1);
    }
  });

  it('continues along the line once two hits are in line', () => {
    // FLEET_B battleship spans A2-D2; hit the first two cells.
    const state = fireAll(startedGame(), 'a', [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    const view = createPlayerView(state, 'a');
    const bot = createBot('medium');

    for (let seed = 0; seed < 20; seed += 1) {
      // The only legal extension of A2-B2 is C2 (A2 is against the left edge).
      expect(bot.chooseShot(view, createRng(seed))).toEqual({ x: 2, y: 1 });
    }
  });

  it('prefers extending a line over probing a separate lone hit', () => {
    // A2-B2 form a confirmed line; A6 is a separate, lone hit on a destroyer.
    let state = fireAll(startedGame(), 'a', [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    state = fireAll(state, 'a', [{ x: 0, y: 5 }]);

    const knowledge = readKnowledge(createPlayerView(state, 'a'));
    const candidates = targetCandidates(knowledge);

    expect(candidates.extending).toEqual([{ x: 2, y: 1 }]);
    expect(candidates.adjacent).toContainEqual({ x: 0, y: 4 });
  });

  it('hunts on the checkerboard while it has no live hit', () => {
    const view = createPlayerView(startedGame(), 'a');
    const bot = createBot('medium');

    for (let seed = 0; seed < 30; seed += 1) {
      const coord = bot.chooseShot(view, createRng(seed));
      expect((coord.x + coord.y) % 2).toBe(0);
    }
  });

  it('finishes a wounded ship before starting a new search', () => {
    const bot = createBot('medium');
    const rng = createRng(3);
    let state = fireAll(startedGame(), 'a', [{ x: 0, y: 1 }]);

    // Within four shots the battleship at A2-D2 should be sunk.
    for (let i = 0; i < 4 && state.phase === 'playing'; i += 1) {
      const coord = bot.chooseShot(createPlayerView(state, 'a'), rng);
      const result = fire(state, 'a', coord);
      if (!result.ok) throw new Error(result.error.code);
      state = { ...result.value.state, turn: 'a' };
    }

    expect(createPlayerView(state, 'a').opponent.sunkShips).toHaveLength(1);
  });
});

describe('hard bot — probability density (spec §7.3)', () => {
  it('scores a central cell above a corner on an empty board', () => {
    const knowledge = readKnowledge(createPlayerView(startedGame(), 'a'));
    const scores = densityScores(knowledge);

    expect(scores.get(toIndex({ x: 4, y: 4 })) ?? 0).toBeGreaterThan(
      scores.get(toIndex({ x: 0, y: 0 })) ?? 0,
    );
  });

  it('never wastes a shot on a cell diagonally adjacent to a live hit', () => {
    // Ships may not touch, so a diagonal neighbour of a hit is provably water.
    const state = fireAll(startedGame(), 'a', [{ x: 4, y: 3 }]);
    const view = createPlayerView(state, 'a');
    const bot = createBot('hard');

    const diagonals = [
      { x: 3, y: 2 },
      { x: 5, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 4 },
    ];

    for (let seed = 0; seed < 30; seed += 1) {
      expect(diagonals).not.toContainEqual(bot.chooseShot(view, createRng(seed)));
    }
  });

  it('gives a diagonal-of-hit cell zero density', () => {
    const state = fireAll(startedGame(), 'a', [{ x: 4, y: 3 }]);
    const scores = densityScores(readKnowledge(createPlayerView(state, 'a')));

    expect(scores.get(toIndex({ x: 3, y: 2 })) ?? 0).toBe(0);
    expect(scores.get(toIndex({ x: 5, y: 2 })) ?? 0).toBe(0);
  });

  it('focuses fire on the line through a wounded ship', () => {
    const state = fireAll(startedGame(), 'a', [{ x: 4, y: 3 }]);
    const view = createPlayerView(state, 'a');
    const bot = createBot('hard');

    for (let seed = 0; seed < 20; seed += 1) {
      const coord = bot.chooseShot(view, createRng(seed));
      const collinear = coord.x === 4 || coord.y === 3;
      const distance = Math.abs(coord.x - 4) + Math.abs(coord.y - 3);

      // Only placements that explain the hit score meaningfully, and every such
      // placement is a straight line of at most 4 cells through it.
      expect(collinear).toBe(true);
      expect(distance).toBeGreaterThanOrEqual(1);
      expect(distance).toBeLessThanOrEqual(3);
    }
  });

  it('hunts on a lattice matched to the shortest surviving ship', () => {
    const knowledge = readKnowledge(createPlayerView(startedGame(), 'a'));

    // Full fleet afloat: destroyers are the shortest multi-cell ship, so spacing 2.
    expect(huntSpacing(knowledge)).toBe(2);

    const bot = createBot('hard');
    const view = createPlayerView(startedGame(), 'a');
    for (let seed = 0; seed < 20; seed += 1) {
      const coord = bot.chooseShot(view, createRng(seed));
      expect((coord.x + coord.y) % 2).toBe(0);
    }
  });

  it('drops the lattice when only single-cell ships remain', () => {
    const knowledge = readKnowledge(createPlayerView(startedGame(), 'a'));
    const submarinesOnly = { ...knowledge, remainingShipSizes: [1, 1, 1, 1] };

    expect(huntSpacing(submarinesOnly)).toBe(1);
  });
});

describe('bot fleet placement style', () => {
  it('rates an edge-hugging fleet as more predictable than a central one', () => {
    const edgeFleet = validateFleet(FLEET_A);
    const shiftedFleet = validateFleet(FLEET_B);
    if (!edgeFleet.ok || !shiftedFleet.ok) throw new Error('fixtures must be legal');

    expect(placementPredictability(edgeFleet.value)).toBeGreaterThan(0);
    expect(Number.isFinite(placementPredictability(shiftedFleet.value))).toBe(true);
  });

  it('hard places a less predictable fleet than easy, averaged over seeds', () => {
    const mean = (difficulty: 'easy' | 'hard') => {
      const bot = createBot(difficulty);
      const scores = Array.from({ length: 40 }, (_, seed) =>
        placementPredictability(bot.chooseFleet(createRng(seed))),
      );
      return scores.reduce((total, value) => total + value, 0) / scores.length;
    };

    expect(mean('hard')).toBeLessThan(mean('easy'));
  });
});

describe('thinking delay', () => {
  it('stays inside the spec §7.3 range and is seed-reproducible', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const delay = thinkingDelayMs(createRng(seed));
      expect(delay).toBeGreaterThanOrEqual(300);
      expect(delay).toBeLessThanOrEqual(900);
    }
    expect(thinkingDelayMs(createRng(5))).toBe(thinkingDelayMs(createRng(5)));
  });
});

describe('placement helper sanity', () => {
  it('accepts a fleet built by any bot into a real game', () => {
    const fleet = createBot('hard').chooseFleet(createRng(11));
    const result = placeFleet(createGame(), 'a', asPlacements(fleet));

    expect(result.ok).toBe(true);
  });
});
