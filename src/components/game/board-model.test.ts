import { describe, expect, it } from 'vitest';

import { toIndex } from '@/game/coord';
import { fire } from '@/game/fire';
import { createBotMatch, placeHumanFleet, snapshotOf } from '@/game/match/bot-match';
import { FLEET_A } from '@/game/testing/fixtures';
import type { Coord } from '@/game/types';
import { opponentMarks, opponentOutlines, ownMarks, ownOutlines } from './board-model';

function startedMatch(seed = 5) {
  const placed = placeHumanFleet(createBotMatch({ difficulty: 'medium', seed }), FLEET_A);
  if (!placed.ok) throw new Error('fixture fleet must be legal');
  return placed.value;
}

describe('board render model', () => {
  it('maps an untouched enemy board to nothing but water', () => {
    const marks = opponentMarks(snapshotOf(startedMatch()).view);

    expect(marks.flat()).toHaveLength(100);
    expect(new Set(marks.flat())).toEqual(new Set(['water']));
  });

  it('shows the player their own ships', () => {
    const marks = ownMarks(snapshotOf(startedMatch()).view);

    expect(marks.flat().filter((mark) => mark === 'ship')).toHaveLength(20);
    expect(ownOutlines(snapshotOf(startedMatch()).view)).toHaveLength(10);
  });

  /**
   * The render layer's half of the hidden-information guarantee: the only enemy
   * ship geometry it can draw comes from `view.opponent.sunkShips`, which the
   * engine populates for sunk ships alone.
   */
  it('draws no enemy ship outline until a ship is actually sunk', () => {
    const match = startedMatch();
    expect(opponentOutlines(snapshotOf(match).view)).toEqual([]);

    // Hit one cell of a bot ship without sinking it.
    const ship = match.game.boards.b.ships.find((candidate) => candidate.size > 1);
    if (!ship) throw new Error('expected a multi-cell ship');

    const hit = fire(match.game, 'a', ship.cells[0] as Coord);
    if (!hit.ok) throw new Error('shot must land');

    const wounded = snapshotOf({ ...match, game: hit.value.state });
    expect(opponentOutlines(wounded.view)).toEqual([]);
    expect(
      opponentMarks(wounded.view)
        .flat()
        .filter((mark) => mark === 'hit'),
    ).toHaveLength(1);
  });

  it('draws the outline only once the whole ship is down', () => {
    const match = startedMatch();
    const ship = match.game.boards.b.ships[0];
    if (!ship) throw new Error('expected a ship');

    let game = match.game;
    for (const cell of ship.cells) {
      const result = fire(game, 'a', cell);
      if (!result.ok) throw new Error(result.error.code);
      game = result.value.state;
    }

    const outlines = opponentOutlines(snapshotOf({ ...match, game }).view);
    expect(outlines).toHaveLength(1);
    expect(outlines[0]?.cells).toEqual(ship.cells);
    expect(outlines[0]?.sunk).toBe(true);
  });

  it('never renders a mark on an un-fired enemy ship cell', () => {
    const match = startedMatch();
    const marks = opponentMarks(snapshotOf(match).view);
    const board = match.game.boards.b;

    for (const ship of board.ships) {
      for (const cell of ship.cells) {
        if (!board.shots.has(toIndex(cell))) {
          expect(marks[cell.y]?.[cell.x]).toBe('water');
        }
      }
    }
  });

  it('produces an identical render model for two different hidden fleets', () => {
    const a = opponentMarks(snapshotOf(startedMatch(101)).view);
    const b = opponentMarks(snapshotOf(startedMatch(202)).view);

    expect(a).toEqual(b);
    expect(opponentOutlines(snapshotOf(startedMatch(101)).view)).toEqual(
      opponentOutlines(snapshotOf(startedMatch(202)).view),
    );
  });
});
