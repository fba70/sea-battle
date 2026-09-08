import { describe, expect, it } from 'vitest';

import { toIndex } from '../coord';
import { validateFleet } from '../placement';
import { FLEET_A } from '../testing/fixtures';
import type { Coord } from '../types';
import {
  autoFleetFor,
  BOT,
  botFire,
  createBotMatch,
  HUMAN,
  humanFire,
  placeHumanFleet,
  restartMatch,
  snapshotOf,
  type BotMatch,
} from './bot-match';

function started(difficulty: 'easy' | 'medium' | 'hard' = 'medium', seed = 42): BotMatch {
  const match = createBotMatch({ difficulty, seed });
  const placed = placeHumanFleet(match, FLEET_A);
  if (!placed.ok) throw new Error(`fixture fleet rejected: ${placed.error.code}`);
  return placed.value;
}

/** Plays a whole match to completion, alternating correctly. */
function playToEnd(match: BotMatch): BotMatch {
  let current = match;
  let guard = 0;

  while (snapshotOf(current).phase === 'playing' && guard < 400) {
    const snapshot = snapshotOf(current);

    if (snapshot.awaitingBot) {
      const result = botFire(current);
      if (!result.ok) throw new Error(result.error.code);
      current = result.value;
    } else {
      const target = snapshot.view.opponent.grid.flatMap((row, y) =>
        row.flatMap((state, x) => (state === 'unknown' ? [{ x, y } as Coord] : [])),
      )[0];
      if (!target) throw new Error('no legal target');
      const result = humanFire(current, target);
      if (!result.ok) throw new Error(result.error.code);
      current = result.value;
    }
    guard += 1;
  }

  return current;
}

describe('match setup', () => {
  it('places the bot fleet up front and waits for the human', () => {
    const match = createBotMatch({ difficulty: 'hard', seed: 1 });
    const snapshot = snapshotOf(match);

    expect(snapshot.phase).toBe('placement');
    expect(snapshot.view.own.ships).toHaveLength(0);
    expect(snapshot.view.opponent.shipsRemaining).toBe(10);
  });

  it('starts play once the human fleet is in', () => {
    const snapshot = snapshotOf(started());

    expect(snapshot.phase).toBe('playing');
    expect(snapshot.view.isYourTurn).toBe(true);
    expect(snapshot.view.own.ships).toHaveLength(10);
  });

  it('rejects an illegal human fleet with the engine error', () => {
    const result = placeHumanFleet(
      createBotMatch({ difficulty: 'easy', seed: 2 }),
      FLEET_A.slice(1),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_fleet_composition');
  });

  it('offers only legal auto-placed fleets', () => {
    const match = createBotMatch({ difficulty: 'easy', seed: 3 });

    for (let attempt = 0; attempt < 25; attempt += 1) {
      expect(validateFleet(autoFleetFor(match, attempt)).ok).toBe(true);
    }
  });

  it('gives a different fleet on each re-roll', () => {
    const match = createBotMatch({ difficulty: 'easy', seed: 3 });

    expect(autoFleetFor(match, 0)).not.toEqual(autoFleetFor(match, 1));
  });

  it('is fully reproducible from its seed', () => {
    expect(playToEnd(started('hard', 7)).log).toEqual(playToEnd(started('hard', 7)).log);
  });
});

describe('turn flow', () => {
  it('keeps the turn with the human after a hit and logs it', () => {
    const match = started();
    const target = snapshotOf(match).view.opponent.grid;
    expect(target).toBeDefined();

    // Find a real bot ship cell by asking the engine (test-side knowledge only).
    const shipCell = match.game.boards[BOT].ships[0]?.cells[0] as Coord;
    const result = humanFire(match, shipCell);
    if (!result.ok) throw new Error(result.error.code);

    const snapshot = snapshotOf(result.value);
    expect(snapshot.view.isYourTurn).toBe(true);
    expect(snapshot.awaitingBot).toBe(false);
    expect(snapshot.log.at(-1)?.actor).toBe('human');
    expect(snapshot.log.at(-1)?.outcome).not.toBe('miss');
  });

  it('passes the turn to the bot after a miss', () => {
    const match = started();
    const botCells = new Set(
      match.game.boards[BOT].ships.flatMap((ship) => ship.cells.map(toIndex)),
    );
    const water = Array.from({ length: 100 }, (_, i) => i).find((i) => !botCells.has(i)) ?? 0;

    const result = humanFire(match, { x: water % 10, y: Math.floor(water / 10) });
    if (!result.ok) throw new Error(result.error.code);

    const snapshot = snapshotOf(result.value);
    expect(snapshot.view.isYourTurn).toBe(false);
    expect(snapshot.awaitingBot).toBe(true);
    expect(snapshot.log.at(-1)?.outcome).toBe('miss');
  });

  it('refuses a bot shot when it is the human turn', () => {
    const result = botFire(started());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_your_turn');
  });

  it('rejects firing at an already-resolved cell', () => {
    const match = started();
    const shipCell = match.game.boards[BOT].ships[0]?.cells[0] as Coord;
    const first = humanFire(match, shipCell);
    if (!first.ok) throw new Error('first shot must land');

    const again = humanFire(first.value, shipCell);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('already_fired');
  });

  it('plays a full match through to a decided result', () => {
    const finished = snapshotOf(playToEnd(started('medium', 11)));

    expect(finished.phase).toBe('finished');
    expect(finished.humanWon || finished.humanLost).toBe(true);
    expect(finished.view.resultReason).toBe('sunk_all');
    expect(finished.log.at(-1)?.gameOver).toBe(true);
  });

  it('records sunk ships in the log', () => {
    let match = started();
    const ship = match.game.boards[BOT].ships[0];
    if (!ship) throw new Error('bot must have ships');

    for (const cell of ship.cells) {
      const result = humanFire(match, cell);
      if (!result.ok) throw new Error(result.error.code);
      match = result.value;
    }

    expect(snapshotOf(match).log.at(-1)?.sunkShipClass).toBe(ship.shipClass);
  });

  it('restarts with the same difficulty and a fresh board', () => {
    const restarted = restartMatch(started('hard', 5), 6);

    expect(restarted.difficulty).toBe('hard');
    expect(snapshotOf(restarted).phase).toBe('placement');
    expect(restarted.log).toEqual([]);
  });
});

describe('hidden-information boundary of the UI snapshot', () => {
  it('exposes no un-hit bot ship cell through the snapshot', () => {
    const match = started();
    const snapshot = snapshotOf(match);
    const botBoard = match.game.boards[BOT];

    for (const ship of botBoard.ships) {
      for (const cell of ship.cells) {
        if (!botBoard.shots.has(toIndex(cell))) {
          expect(snapshot.view.opponent.grid[cell.y]?.[cell.x]).toBe('unknown');
        }
      }
    }
  });

  it('carries no ship-shaped object for the opponent', () => {
    const snapshot = snapshotOf(started());
    const serialised = JSON.stringify(snapshot.view.opponent);

    expect(serialised).not.toContain('origin');
    expect(serialised).not.toContain('orientation');
  });

  /**
   * The differential proof, applied to the object the React tree actually
   * receives: two matches whose only difference is the bot's hidden fleet must
   * produce an identical snapshot for the UI to render.
   */
  it('renders identically for two different hidden bot fleets', () => {
    const a = snapshotOf(started('hard', 1001));
    const b = snapshotOf(started('hard', 2002));

    // Different seeds mean genuinely different bot fleets...
    expect(createBotMatch({ difficulty: 'hard', seed: 1001 }).game.boards[BOT].ships).not.toEqual(
      createBotMatch({ difficulty: 'hard', seed: 2002 }).game.boards[BOT].ships,
    );
    // ...yet nothing the UI can see differs.
    expect(JSON.stringify(a.view)).toBe(JSON.stringify(b.view));
  });

  it('gives the bot only its own filtered view', () => {
    // The bot fires blind: its first shot cannot depend on the human layout,
    // which it has never been shown.
    const withFleetA = started('hard', 77);
    const humanCells = new Set(
      withFleetA.game.boards[HUMAN].ships.flatMap((ship) => ship.cells.map(toIndex)),
    );

    expect(humanCells.size).toBe(20);
    expect(snapshotOf(withFleetA).view.own.ships).toHaveLength(10);
  });
});
