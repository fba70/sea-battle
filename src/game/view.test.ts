import { describe, expect, it } from 'vitest';

import { toIndex } from './coord';
import type { GameState } from './state';
import { FLEET_A, FLEET_B } from './testing/fixtures';
import { fireAll, startedGame } from './testing/harness';
import type { Coord, PlayerSlot } from './types';
import {
  createPlayerView,
  createPublicView,
  opponentCellAt,
  ownCellAt,
  type PlayerView,
} from './view';

const ALWAYS_MISS: Coord = { x: 9, y: 9 };

/** Every cell of every ship on `slot`'s board that has not been fired at. */
function unrevealedShipCells(state: GameState, slot: PlayerSlot): Coord[] {
  const board = state.boards[slot];
  return board.ships.flatMap((ship) =>
    ship.cells.filter((cell) => !board.shots.has(toIndex(cell))),
  );
}

/** Recursively collects every object in a structure that looks like a ship. */
function shipShapedObjects(value: unknown, found: object[] = []): object[] {
  if (Array.isArray(value)) {
    for (const entry of value) shipShapedObjects(entry, found);
  } else if (value && typeof value === 'object') {
    if ('origin' in value && 'orientation' in value && 'cells' in value) {
      found.push(value);
    }
    for (const entry of Object.values(value)) shipShapedObjects(entry, found);
  }
  return found;
}

describe('own board view', () => {
  it('shows the viewer their own fleet in full', () => {
    const view = createPlayerView(startedGame(), 'a');

    expect(view.own.ships).toHaveLength(10);
    expect(ownCellAt(view, { x: 0, y: 0 })).toBe('ship');
    expect(ownCellAt(view, ALWAYS_MISS)).toBe('empty');
  });

  it('marks incoming hits, misses and sinkings', () => {
    let state = fireAll(startedGame(), 'a', [ALWAYS_MISS]);
    // B fires at A: hit on A1, miss in column J, then sinks the H3 submarine.
    state = fireAll(state, 'b', [{ x: 0, y: 0 }]);
    state = fireAll(state, 'b', [{ x: 7, y: 2 }]);
    state = fireAll(state, 'b', [{ x: 8, y: 8 }]);

    const view = createPlayerView(state, 'a');

    expect(ownCellAt(view, { x: 0, y: 0 })).toBe('hit');
    expect(ownCellAt(view, { x: 7, y: 2 })).toBe('sunk');
    expect(ownCellAt(view, { x: 8, y: 8 })).toBe('miss');
    expect(view.own.shipsRemaining).toBe(9);
    expect(view.own.shipsSunk).toBe(1);
    expect(view.own.incomingShots).toBe(3);
  });
});

describe('opponent board view', () => {
  it('starts entirely unknown', () => {
    const view = createPlayerView(startedGame(), 'a');

    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        expect(opponentCellAt(view, { x, y })).toBe('unknown');
      }
    }
    expect(view.opponent.sunkShips).toEqual([]);
    expect(view.opponent.shipsRemaining).toBe(10);
  });

  it('reveals only the cells the viewer has actually fired at', () => {
    const state = fireAll(startedGame(), 'a', [{ x: 0, y: 1 }]);
    const view = createPlayerView(state, 'a');

    expect(opponentCellAt(view, { x: 0, y: 1 })).toBe('hit');
    // The neighbouring cell of the same ship stays hidden.
    expect(opponentCellAt(view, { x: 1, y: 1 })).toBe('unknown');
  });

  it('reveals the outline and buffer of a sunk ship', () => {
    const state = fireAll(startedGame(), 'a', [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
    const view = createPlayerView(state, 'a');

    for (const cell of [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]) {
      expect(opponentCellAt(view, cell)).toBe('sunk');
    }
    expect(opponentCellAt(view, { x: 4, y: 1 })).toBe('known_empty');
    expect(view.opponent.sunkShips).toEqual([
      {
        shipClass: 'battleship',
        cells: [
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 3, y: 1 },
        ],
      },
    ]);
    expect(view.opponent.shipsRemaining).toBe(9);
  });

  it('tracks shot and hit counts', () => {
    let state = fireAll(startedGame(), 'a', [{ x: 0, y: 1 }]);
    state = fireAll(state, 'a', [ALWAYS_MISS]);
    const view = createPlayerView(state, 'a');

    expect(view.opponent.shotsFired).toBe(2);
    expect(view.opponent.hits).toBe(1);
  });
});

describe('hidden-information boundary (spec §5.1, §10)', () => {
  it('never marks an un-fired opponent ship cell as anything but unknown', () => {
    const state = fireAll(startedGame(), 'a', [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    const view = createPlayerView(state, 'a');

    for (const cell of unrevealedShipCells(state, 'b')) {
      expect(opponentCellAt(view, cell)).toBe('unknown');
    }
  });

  it('exposes no ship-shaped object for any un-sunk opponent ship', () => {
    const state = fireAll(startedGame(), 'a', [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    const view = createPlayerView(state, 'a');

    const opponentShips = shipShapedObjects(view.opponent);
    expect(opponentShips).toEqual([]);

    // The viewer's own fleet is legitimately present on the own side.
    expect(shipShapedObjects(view.own)).toHaveLength(10);
  });

  it('serialises no un-revealed opponent ship position', () => {
    const state = fireAll(startedGame(), 'a', [{ x: 0, y: 1 }]);
    const serialised = JSON.parse(JSON.stringify(createPlayerView(state, 'a'))) as PlayerView;

    // Anything the wire format exposes about the opponent must survive this check.
    for (const cell of unrevealedShipCells(state, 'b')) {
      expect(opponentCellAt(serialised, cell)).toBe('unknown');
    }
    expect(shipShapedObjects(serialised.opponent)).toEqual([]);
  });

  /**
   * The strongest form of the guarantee: if the view leaked *any* information about
   * where the opponent's un-hit ships are, then changing that placement would change
   * the view. Two games that differ only in the opponent's hidden layout must be
   * byte-for-byte indistinguishable to the viewer.
   */
  it('is byte-identical for two different opponent fleets the viewer has not touched', () => {
    // FLEET_A and FLEET_B occupy different rows but both leave columns I/J empty.
    const columnJ: Coord[] = Array.from({ length: 5 }, (_, y) => ({ x: 9, y }));

    const withFleetB = fireAll(startedGame(FLEET_A, FLEET_B), 'a', columnJ.slice(0, 1));
    const withFleetA = fireAll(startedGame(FLEET_A, FLEET_A), 'a', columnJ.slice(0, 1));

    const viewOfB = createPlayerView(withFleetB, 'a');
    const viewOfA = createPlayerView(withFleetA, 'a');

    expect(JSON.stringify(viewOfB)).toBe(JSON.stringify(viewOfA));
  });

  it('the differential check is sensitive: a real hit does change the view', () => {
    // Control for the test above — proves it would notice a leak rather than
    // passing vacuously.
    const hitOnB = fireAll(startedGame(FLEET_A, FLEET_B), 'a', [{ x: 0, y: 1 }]);
    const missOnA = fireAll(startedGame(FLEET_A, FLEET_A), 'a', [{ x: 0, y: 1 }]);

    expect(JSON.stringify(createPlayerView(hitOnB, 'a'))).not.toBe(
      JSON.stringify(createPlayerView(missOnA, 'a')),
    );
  });

  it('keeps the guarantee symmetric — B learns nothing about A either', () => {
    let state = fireAll(startedGame(), 'a', [ALWAYS_MISS]);
    state = fireAll(state, 'b', [{ x: 0, y: 0 }]);

    const view = createPlayerView(state, 'b');
    for (const cell of unrevealedShipCells(state, 'a')) {
      expect(opponentCellAt(view, cell)).toBe('unknown');
    }
  });

  it('still hides un-hit ships after the game is over', () => {
    // A wins; B's surviving-ship information is moot, but A's board must not leak
    // to B just because play stopped.
    const start = startedGame();
    const state = fireAll(
      start,
      'a',
      start.boards.b.ships.flatMap((ship) => ship.cells),
    );

    expect(state.phase).toBe('finished');
    const loserView = createPlayerView(state, 'b');
    for (const cell of unrevealedShipCells(state, 'a')) {
      expect(opponentCellAt(loserView, cell)).toBe('unknown');
    }
  });
});

describe('public view', () => {
  it('exposes neither fleet, only what has been revealed', () => {
    const state = fireAll(startedGame(), 'a', [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
    const view = createPublicView(state);

    expect(shipShapedObjects(view)).toEqual([]);
    expect(view.boards.b.grid[1]?.[0]).toBe('hit');
    expect(view.boards.b.grid[1]?.[9]).toBe('unknown');
    expect(view.boards.a.shipsRemaining).toBe(10);
  });

  it('lists sunk ships for both sides', () => {
    const state = fireAll(startedGame(), 'a', [{ x: 7, y: 3 }]);
    const view = createPublicView(state);

    expect(view.boards.b.sunkShips).toHaveLength(1);
    expect(view.boards.b.sunkShips[0]?.shipClass).toBe('submarine');
    expect(view.boards.a.sunkShips).toEqual([]);
    expect(view.boards.b.shipsRemaining).toBe(9);
  });

  it('is identical for two different hidden layouts', () => {
    const a = createPublicView(startedGame(FLEET_A, FLEET_A));
    const b = createPublicView(startedGame(FLEET_A, FLEET_B));

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('view metadata', () => {
  it('tells each player whether it is their turn', () => {
    const state = startedGame();

    expect(createPlayerView(state, 'a').isYourTurn).toBe(true);
    expect(createPlayerView(state, 'b').isYourTurn).toBe(false);
  });

  it('carries the result once the game ends', () => {
    const start = startedGame();
    const state = fireAll(
      start,
      'a',
      start.boards.b.ships.flatMap((ship) => ship.cells),
    );
    const view = createPlayerView(state, 'b');

    expect(view.phase).toBe('finished');
    expect(view.winner).toBe('a');
    expect(view.resultReason).toBe('sunk_all');
  });

  it('rejects off-board lookups', () => {
    const view = createPlayerView(startedGame(), 'a');

    expect(() => ownCellAt(view, { x: 10, y: 0 })).toThrow(RangeError);
    expect(() => opponentCellAt(view, { x: 0, y: -1 })).toThrow(RangeError);
  });
});
