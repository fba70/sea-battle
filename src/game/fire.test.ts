import { describe, expect, it } from 'vitest';

import { fire, legalTargets } from './fire';
import { createGame, opponentOf, placeFleet, shipsRemaining } from './state';
import { FLEET_A, FLEET_B } from './testing/fixtures';
import { fireAll, startedGame } from './testing/harness';
import type { Coord } from './types';

/** Cell in column J — empty in both fixture fleets, so always a miss. */
const ALWAYS_MISS: Coord = { x: 9, y: 9 };
const ANOTHER_MISS: Coord = { x: 9, y: 8 };

/** FLEET_B is FLEET_A shifted down one row, so its battleship sits at A2-D2. */
const B_BATTLESHIP: readonly Coord[] = [
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 2, y: 1 },
  { x: 3, y: 1 },
];

describe('game setup', () => {
  it('starts in the placement phase with nobody to move', () => {
    const game = createGame();

    expect(game.phase).toBe('placement');
    expect(game.turn).toBeNull();
  });

  it('stays in placement until both fleets are in', () => {
    const placed = placeFleet(createGame(), 'a', FLEET_A);
    if (!placed.ok) throw new Error('fixture must be legal');

    expect(placed.value.phase).toBe('placement');
    expect(placed.value.turn).toBeNull();
  });

  it('starts play once both fleets are in, honouring firstTurn', () => {
    expect(startedGame(FLEET_A, FLEET_B, 'a').turn).toBe('a');
    expect(startedGame(FLEET_A, FLEET_B, 'b').turn).toBe('b');
    expect(startedGame().phase).toBe('playing');
  });

  it('refuses a second fleet from the same player', () => {
    const placed = placeFleet(createGame(), 'a', FLEET_A);
    if (!placed.ok) throw new Error('fixture must be legal');

    const again = placeFleet(placed.value, 'a', FLEET_A);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('already_placed');
  });

  it('refuses placement once play has started', () => {
    const result = placeFleet(startedGame(), 'a', FLEET_A);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_phase');
  });
});

describe('Classic turn structure (spec §4)', () => {
  it('passes the turn on a miss', () => {
    const result = fire(startedGame(), 'a', ALWAYS_MISS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.event.outcome).toBe('miss');
    expect(result.value.event.extraTurn).toBe(false);
    expect(result.value.state.turn).toBe('b');
  });

  it('keeps the turn on a hit', () => {
    const result = fire(startedGame(), 'a', { x: 0, y: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.event.outcome).toBe('hit');
    expect(result.value.event.extraTurn).toBe(true);
    expect(result.value.state.turn).toBe('a');
  });

  it('keeps the turn on a sinking hit', () => {
    const state = fireAll(startedGame(), 'a', B_BATTLESHIP.slice(0, 3));
    const result = fire(state, 'a', B_BATTLESHIP[3] as Coord);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.event.outcome).toBe('sunk');
    expect(result.value.event.extraTurn).toBe(true);
    expect(result.value.state.turn).toBe('a');
  });

  it('counts every resolved shot', () => {
    const state = fireAll(startedGame(), 'a', [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);

    expect(state.moveCount).toBe(2);
  });

  it('never mutates the state it was given', () => {
    const before = startedGame();
    const snapshot = JSON.stringify({
      turn: before.turn,
      shots: [...before.boards.b.shots],
      moveCount: before.moveCount,
    });

    fire(before, 'a', ALWAYS_MISS);

    expect(
      JSON.stringify({
        turn: before.turn,
        shots: [...before.boards.b.shots],
        moveCount: before.moveCount,
      }),
    ).toBe(snapshot);
  });
});

describe('shot rejection (spec §9 server authority rules)', () => {
  it('rejects a shot from the player whose turn it is not', () => {
    const result = fire(startedGame(), 'b', ALWAYS_MISS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_your_turn');
  });

  it('rejects a shot during the placement phase', () => {
    const result = fire(createGame(), 'a', ALWAYS_MISS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_phase');
  });

  it.each([
    { x: -1, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
    { x: 0.5, y: 0 },
    { x: Number.NaN, y: 0 },
  ])('rejects the off-board shot %j', (coord) => {
    const result = fire(startedGame(), 'a', coord);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('out_of_bounds');
  });

  it('rejects firing at the same cell twice', () => {
    const state = fireAll(startedGame(), 'a', [{ x: 0, y: 1 }]);
    const result = fire(state, 'a', { x: 0, y: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('already_fired');
  });

  it('rejects a repeat even after the turn has come back around', () => {
    let state = fireAll(startedGame(), 'a', [ALWAYS_MISS]);
    state = fireAll(state, 'b', [ALWAYS_MISS]);

    const result = fire(state, 'a', ALWAYS_MISS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('already_fired');
  });

  it('leaves the game untouched when a shot is rejected', () => {
    const state = startedGame();
    const result = fire(state, 'b', ALWAYS_MISS);

    expect(result.ok).toBe(false);
    expect(state.moveCount).toBe(0);
    expect(state.turn).toBe('a');
  });
});

describe('sinking a ship (spec §4)', () => {
  it('reveals the outline and the surrounding buffer as known-empty', () => {
    const state = fireAll(startedGame(), 'a', B_BATTLESHIP.slice(0, 3));
    const result = fire(state, 'a', B_BATTLESHIP[3] as Coord);
    if (!result.ok) throw new Error('sinking shot must be accepted');

    const sunk = result.value.event.sunk;
    expect(sunk).toBeDefined();
    expect(sunk?.shipClass).toBe('battleship');
    expect(sunk?.outline).toEqual(B_BATTLESHIP);

    // A2-D2 runs along the left edge, so the ring is clipped: 5 above (A1-E1),
    // 1 to the right (E2) and 5 below (A3-E3) = 11 cells.
    expect(sunk?.bufferCells).toHaveLength(11);
    expect(sunk?.bufferCells).toContainEqual({ x: 4, y: 1 });
    expect(sunk?.bufferCells).toContainEqual({ x: 0, y: 0 });
  });

  it('refuses further shots into the revealed buffer', () => {
    let state = fireAll(startedGame(), 'a', B_BATTLESHIP);
    const result = fire(state, 'a', { x: 4, y: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('already_known_empty');

    // ...and the cell is gone from the legal target list.
    state = fireAll(state, 'a', [{ x: 9, y: 0 }]);
    expect(legalTargets(state, 'a')).not.toContainEqual({ x: 4, y: 1 });
  });

  it('does not rewrite a buffer cell that had already been missed', () => {
    // Miss at E2 first, then sink the battleship whose buffer includes E2.
    let state = fireAll(startedGame(), 'a', [{ x: 4, y: 1 }]);
    state = fireAll(state, 'b', [ALWAYS_MISS]);
    state = fireAll(state, 'a', B_BATTLESHIP);

    expect(state.boards.b.shots.has(1 * 10 + 4)).toBe(true);
    expect(state.boards.b.revealedEmpty.has(1 * 10 + 4)).toBe(false);
  });

  it('reports hit rather than sunk while the ship is still afloat', () => {
    const result = fire(startedGame(), 'a', B_BATTLESHIP[0] as Coord);
    if (!result.ok) throw new Error('shot must be accepted');

    expect(result.value.event.outcome).toBe('hit');
    expect(result.value.event.sunk).toBeUndefined();
  });

  it('sinks a single-cell submarine in one shot', () => {
    // FLEET_B submarine at H4 (x 7, y 3).
    const result = fire(startedGame(), 'a', { x: 7, y: 3 });
    if (!result.ok) throw new Error('shot must be accepted');

    expect(result.value.event.outcome).toBe('sunk');
    expect(result.value.event.sunk?.shipClass).toBe('submarine');
    expect(result.value.event.sunk?.outline).toEqual([{ x: 7, y: 3 }]);
  });
});

describe('win detection', () => {
  it('ends the game when the last ship is sunk', () => {
    const start = startedGame();
    const allCells = start.boards.b.ships.flatMap((ship) => ship.cells);

    // Every shot is a hit, so player A keeps the turn throughout.
    const state = fireAll(start, 'a', allCells);

    expect(state.phase).toBe('finished');
    expect(state.winner).toBe('a');
    expect(state.resultReason).toBe('sunk_all');
    expect(state.turn).toBeNull();
    expect(shipsRemaining(state.boards.b)).toBe(0);
  });

  it('grants no extra turn on the winning shot', () => {
    const start = startedGame();
    const allCells = start.boards.b.ships.flatMap((ship) => ship.cells);
    const state = fireAll(start, 'a', allCells.slice(0, -1));

    const result = fire(state, 'a', allCells.at(-1) as Coord);
    if (!result.ok) throw new Error('final shot must be accepted');

    expect(result.value.event.gameOver).toBe(true);
    expect(result.value.event.extraTurn).toBe(false);
  });

  it('refuses any further shot once the game is over', () => {
    const start = startedGame();
    const state = fireAll(
      start,
      'a',
      start.boards.b.ships.flatMap((ship) => ship.cells),
    );

    const result = fire(state, 'a', ALWAYS_MISS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_phase');
  });

  it('leaves the loser fleet intact — only the defender takes damage', () => {
    const state = fireAll(startedGame(), 'a', [ANOTHER_MISS]);

    expect(state.boards.a.shots.size).toBe(0);
    expect(state.boards.b.shots.size).toBe(1);
  });
});

describe('legalTargets', () => {
  it('starts as the whole board and shrinks as cells are resolved', () => {
    const start = startedGame();
    expect(legalTargets(start, 'a')).toHaveLength(100);

    const state = fireAll(start, 'a', [{ x: 0, y: 1 }]);
    expect(legalTargets(state, 'a')).toHaveLength(99);
  });

  it('is empty for the player who is not to move', () => {
    expect(legalTargets(startedGame(), 'b')).toEqual([]);
  });

  it('is empty once the game has finished', () => {
    const start = startedGame();
    const state = fireAll(
      start,
      'a',
      start.boards.b.ships.flatMap((ship) => ship.cells),
    );

    expect(state.phase).toBe('finished');
    expect(legalTargets(state, 'a')).toEqual([]);
  });

  it('targets the defender board, never the shooter own board', () => {
    const state = fireAll(startedGame(), 'a', [{ x: 0, y: 1 }]);

    expect(opponentOf('a')).toBe('b');
    // A's own board is untouched, so nothing was removed from A's target list
    // because of A's own ships.
    expect(state.boards.a.shots.size).toBe(0);
    expect(legalTargets(state, 'a')).not.toContainEqual({ x: 0, y: 1 });
  });
});
