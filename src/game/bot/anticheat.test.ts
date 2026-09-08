import { describe, expect, it } from 'vitest';

import { fire } from '../fire';
import { createRng } from '../rng';
import type { GameState } from '../state';
import { FLEET_A, FLEET_B } from '../testing/fixtures';
import { fireAllForcingTurn, startedGame } from '../testing/harness';
import type { Coord, PlayerSlot } from '../types';
import { createPlayerView } from '../view';
import { BOT_DIFFICULTIES, createBot } from './index';
import type { BotDifficulty } from './types';

/** Column J is open water in both fixture fleets, so firing there always misses. */
const NEUTRAL_SHOTS: readonly Coord[] = [
  { x: 9, y: 0 },
  { x: 9, y: 2 },
  { x: 9, y: 4 },
];

function playFrom(difficulty: BotDifficulty, state: GameState, turns: number, seed: number) {
  const bot = createBot(difficulty);
  const rng = createRng(seed);
  const chosen: Coord[] = [];
  let current = state;

  for (let turn = 0; turn < turns && current.phase === 'playing'; turn += 1) {
    // Normalise the turn so a scenario built from misses is still playable by 'a'.
    current = { ...current, turn: 'a' as PlayerSlot };

    const coord = bot.chooseShot(createPlayerView(current, 'a'), rng);
    chosen.push(coord);

    const result = fire(current, 'a', coord);
    if (!result.ok) {
      throw new Error(`illegal target: ${result.error.code}`);
    }
    current =
      result.value.state.phase === 'playing'
        ? { ...result.value.state, turn: 'a' as PlayerSlot }
        : result.value.state;
  }

  return chosen;
}

describe.each(BOT_DIFFICULTIES)('%s bot cannot see hidden information', (difficulty) => {
  /**
   * The decisive test.
   *
   * Two games are set up that differ ONLY in the opponent's hidden fleet, and the
   * bot fires into water that is empty in both. Its visible `PlayerView` is
   * therefore byte-identical in the two games — so if the bot's choices diverge,
   * it must be reading something it is not entitled to see.
   */
  it('makes identical decisions when only the hidden fleet differs', () => {
    const againstFleetB = fireAllForcingTurn(startedGame(FLEET_A, FLEET_B), 'a', NEUTRAL_SHOTS);
    const againstFleetA = fireAllForcingTurn(startedGame(FLEET_A, FLEET_A), 'a', NEUTRAL_SHOTS);

    // Precondition: the two boards really are laid out differently...
    expect(againstFleetB.boards.b.ships).not.toEqual(againstFleetA.boards.b.ships);
    // ...while the viewer sees exactly the same thing in both.
    expect(JSON.stringify(createPlayerView(againstFleetB, 'a'))).toBe(
      JSON.stringify(createPlayerView(againstFleetA, 'a')),
    );

    const choicesB = playFrom(difficulty, againstFleetB, 1, 4321);
    const choicesA = playFrom(difficulty, againstFleetA, 1, 4321);

    expect(choicesB).toEqual(choicesA);
  });

  it('keeps making identical decisions over a long identical-view sequence', () => {
    // Every shot lands in column I/J, which is water in both fleets, so the views
    // stay identical for the whole run and so must every decision.
    const seedShots: Coord[] = [
      { x: 9, y: 0 },
      { x: 8, y: 0 },
      { x: 9, y: 1 },
    ];

    const againstFleetB = fireAllForcingTurn(startedGame(FLEET_A, FLEET_B), 'a', seedShots);
    const againstFleetA = fireAllForcingTurn(startedGame(FLEET_A, FLEET_A), 'a', seedShots);

    expect(playFrom(difficulty, againstFleetB, 1, 99)).toEqual(
      playFrom(difficulty, againstFleetA, 1, 99),
    );
  });

  it('the check is sensitive: a genuinely different view does change the decision', () => {
    // Control. If the views differ legitimately (a hit vs a miss on the same cell),
    // the bots must react — otherwise the test above would pass vacuously.
    const hitOnB = fireAllForcingTurn(startedGame(FLEET_A, FLEET_B), 'a', [{ x: 0, y: 1 }]);
    const missOnA = fireAllForcingTurn(startedGame(FLEET_A, FLEET_A), 'a', [{ x: 0, y: 1 }]);

    expect(JSON.stringify(createPlayerView(hitOnB, 'a'))).not.toBe(
      JSON.stringify(createPlayerView(missOnA, 'a')),
    );

    if (difficulty === 'easy') {
      // Easy ignores hits by design, so only the hunting bots are expected to react.
      return;
    }

    expect(playFrom(difficulty, hitOnB, 1, 7)).not.toEqual(playFrom(difficulty, missOnA, 1, 7));
  });

  it('never fires at a cell it has not been shown to be unknown', () => {
    const state = fireAllForcingTurn(startedGame(), 'a', [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
    const view = createPlayerView(state, 'a');
    const bot = createBot(difficulty);

    for (let seed = 0; seed < 30; seed += 1) {
      const coord = bot.chooseShot(view, createRng(seed));
      const cellState = view.opponent.grid[coord.y]?.[coord.x];

      expect(cellState).toBe('unknown');
    }
  });
});

describe('bot API surface', () => {
  it('accepts only a PlayerView — there is no way to hand it a GameState', () => {
    const state = startedGame();
    const bot = createBot('hard');

    // A compile-time guarantee, asserted here so the intent is visible: the only
    // argument a bot takes is the filtered view. `state` carries both fleets and
    // is structurally incompatible with the parameter type.
    // @ts-expect-error a GameState must never be accepted where a PlayerView is required
    expect(() => bot.chooseShot(state, createRng(1))).toThrow();
  });
});
