/**
 * The Block 1 security property (spec §5.1, §7.4, §10, §15).
 *
 * `src/game/view.test.ts` already proves `createPlayerView` leaks nothing. This proves
 * the *session* cannot leak either — that no event the session addresses to a player
 * carries anything about the opponent's un-revealed fleet, across accepted intents,
 * rejected intents and snapshots alike.
 *
 * The strong form is differential: if any outbound payload encoded even one bit about
 * where the opponent's un-hit ships are, then changing that hidden layout would change
 * the payload. Two sessions that differ *only* in the opponent's hidden fleet must
 * produce byte-identical streams for the viewer.
 */
import { describe, expect, it } from 'vitest';

import { toIndex } from '@/game/coord';
import { isShipSunk, type GameState } from '@/game/state';
import { FLEET_A, FLEET_B } from '@/game/testing/fixtures';
import type { Coord, PlayerSlot } from '@/game/types';

import type { ClientIntent, ServerEvent } from './protocol';
import { eventsFor, snapshotFor, type GameSession } from './session';
import { playerIdOf, send, startedSession } from './testing';

/**
 * A scripted exchange in which every shot is a miss on both candidate fleets.
 *
 * FLEET_A and FLEET_B both leave columns I and J (x = 8, 9) empty, so A's shots resolve
 * identically whichever fleet seat B holds. B's shots land on seat A's board, which is
 * FLEET_A in every session here, so they resolve identically too.
 */
const SCRIPT: readonly (readonly [PlayerSlot, ClientIntent])[] = [
  ['a', { type: 'fire', cells: [{ x: 8, y: 0 }] }],
  ['b', { type: 'fire', cells: [{ x: 9, y: 9 }] }],
  ['a', { type: 'fire', cells: [{ x: 8, y: 1 }] }],
  ['b', { type: 'fire', cells: [{ x: 9, y: 8 }] }],
  ['a', { type: 'fire', cells: [{ x: 9, y: 0 }] }],
  ['b', { type: 'fire', cells: [{ x: 8, y: 9 }] }],
  // Rejections must be indistinguishable too: an error message or an echoed
  // snapshot would be just as much of a leak as a board.
  ['a', { type: 'fire', cells: [{ x: 99, y: 99 }] }],
  ['a', { type: 'fire', cells: [{ x: 8, y: 0 }] }],
  ['a', { type: 'place_fleet', placements: [...FLEET_A] }],
  ['a', { type: 'ready' }],
  ['a', { type: 'resign' }],
  ['a', { type: 'fire', cells: [{ x: 8, y: 2 }] }],
];

interface Transcript {
  readonly session: GameSession;
  readonly events: Readonly<Record<PlayerSlot, readonly ServerEvent[]>>;
}

/** Runs `script` against `session`, collecting everything each seat would receive. */
function run(
  session: GameSession,
  script: readonly (readonly [PlayerSlot, ClientIntent])[],
): Transcript {
  const collected: Record<PlayerSlot, ServerEvent[]> = { a: [], b: [] };
  const seq: Record<PlayerSlot, number> = { a: 1, b: 1 };
  let current = session;

  for (const [seat, intent] of script) {
    const outcome = send(current, playerIdOf(seat), intent, seq[seat]);
    if (outcome.status === 'accepted') {
      seq[seat] += 1;
    }
    collected.a.push(...eventsFor(outcome, 'a'));
    collected.b.push(...eventsFor(outcome, 'b'));
    current = outcome.session;
  }

  // Plus the snapshot each seat could ask for at any moment.
  collected.a.push(snapshotFor(current, 'a'));
  collected.b.push(snapshotFor(current, 'b'));

  return { session: current, events: collected };
}

/** Every cell of an un-sunk ship on `slot`'s board — exactly what must stay secret. */
function unrevealedShipCells(state: GameState, slot: PlayerSlot): Coord[] {
  const board = state.boards[slot];
  return board.ships
    .filter((ship) => !isShipSunk(ship, board.shots))
    .flatMap((ship) => ship.cells.filter((cell) => !board.shots.has(toIndex(cell))));
}

describe('a session leaks nothing about the opponent’s hidden fleet', () => {
  it('is byte-identical for player A across two different hidden B fleets', () => {
    // Seat A holds FLEET_A in both. Seat B holds a different fleet in each.
    const withFleetA = run(startedSession(FLEET_A, FLEET_A), SCRIPT);
    const withFleetB = run(startedSession(FLEET_A, FLEET_B), SCRIPT);

    expect(JSON.stringify(withFleetB.events.a)).toBe(JSON.stringify(withFleetA.events.a));
  });

  it('is byte-identical for player B across two different hidden A fleets', () => {
    // The mirror image: seat B holds FLEET_B in both, seat A's fleet differs.
    const withFleetA = run(startedSession(FLEET_A, FLEET_B), SCRIPT);
    const withFleetB = run(startedSession(FLEET_B, FLEET_B), SCRIPT);

    expect(JSON.stringify(withFleetB.events.b)).toBe(JSON.stringify(withFleetA.events.b));
  });

  it('the differential check is sensitive: a real hit does change the stream', () => {
    // Control for the two tests above, so they cannot pass vacuously.
    // (0,0) holds FLEET_A's battleship but is empty in FLEET_B.
    const probe: readonly (readonly [PlayerSlot, ClientIntent])[] = [
      ['a', { type: 'fire', cells: [{ x: 0, y: 0 }] }],
    ];

    const hit = run(startedSession(FLEET_A, FLEET_A), probe);
    const miss = run(startedSession(FLEET_A, FLEET_B), probe);

    expect(JSON.stringify(hit.events.a)).not.toBe(JSON.stringify(miss.events.a));
  });

  it('the two players do not receive the same stream', () => {
    // Control: if both seats got one shared payload, the differential tests above
    // could pass while the filter did nothing.
    const { events } = run(startedSession(), SCRIPT);
    expect(JSON.stringify(events.a)).not.toBe(JSON.stringify(events.b));
  });

  it('never names an un-revealed opponent ship cell anywhere in the stream', () => {
    // An independent check that does not rely on differencing. FLEET_A occupies even
    // rows and FLEET_B odd ones, so a coordinate cannot belong to both seats' fleets
    // and a match here is unambiguous.
    const { session, events } = run(startedSession(FLEET_A, FLEET_B), SCRIPT);

    const forA = JSON.stringify(events.a);
    for (const cell of unrevealedShipCells(session.state, 'b')) {
      expect(forA).not.toContain(JSON.stringify(cell));
    }

    const forB = JSON.stringify(events.b);
    for (const cell of unrevealedShipCells(session.state, 'a')) {
      expect(forB).not.toContain(JSON.stringify(cell));
    }

    // Not vacuous: there really are un-revealed ships left on both boards.
    expect(unrevealedShipCells(session.state, 'b').length).toBeGreaterThan(0);
    expect(unrevealedShipCells(session.state, 'a').length).toBeGreaterThan(0);
  });

  it('marks every un-revealed opponent cell as unknown in every snapshot sent', () => {
    const { session, events } = run(startedSession(FLEET_A, FLEET_B), SCRIPT);

    const snapshots = events.a.filter((event) => event.type === 'state_snapshot');
    expect(snapshots.length).toBeGreaterThan(0);

    for (const snapshot of snapshots) {
      for (const cell of unrevealedShipCells(session.state, 'b')) {
        expect(snapshot.view.opponent.grid[cell.y]?.[cell.x]).toBe('unknown');
      }
    }
  });

  it('exposes no ship-shaped object for the opponent in any event', () => {
    const { events } = run(startedSession(FLEET_A, FLEET_B), SCRIPT);

    for (const seat of ['a', 'b'] as const) {
      const ownShipCells = new Set(
        startedSession(FLEET_A, FLEET_B)
          .state.boards[seat].ships.flatMap((ship) => ship.cells)
          .map(toIndex),
      );

      // Any ship outline that reaches a player must be one of their own ships, or a
      // ship that has already sunk. Nothing in this script sinks anything.
      for (const event of events[seat]) {
        if (event.type === 'state_snapshot') {
          expect(event.view.opponent.sunkShips).toEqual([]);
          for (const ship of event.view.own.ships) {
            for (const cell of ship.cells) {
              expect(ownShipCells.has(toIndex(cell))).toBe(true);
            }
          }
        }
        expect(event.type).not.toBe('ship_sunk');
      }
    }
  });
});

describe('a sunk ship is revealed to both players, and nothing more', () => {
  it('reveals the outline only once the ship is actually sunk', () => {
    let session = startedSession(FLEET_A, FLEET_B);
    let seq = 1;

    // FLEET_B's battleship: (0,1) through (3,1).
    for (const x of [0, 1, 2]) {
      const outcome = send(session, playerIdOf('a'), { type: 'fire', cells: [{ x, y: 1 }] }, seq);
      session = outcome.session;
      seq += 1;

      // Three quarters hit, still afloat: no outline may cross the wire.
      for (const seat of ['a', 'b'] as const) {
        expect(eventsFor(outcome, seat).some((event) => event.type === 'ship_sunk')).toBe(false);
        const snapshot = eventsFor(outcome, seat).find((e) => e.type === 'state_snapshot');
        if (snapshot && seat === 'a') {
          expect(snapshot.view.opponent.sunkShips).toEqual([]);
        }
      }

      // The fourth cell is still secret while the ship is afloat.
      expect(JSON.stringify(eventsFor(outcome, 'a'))).not.toContain(JSON.stringify({ x: 3, y: 1 }));
    }

    const sinking = send(session, playerIdOf('a'), { type: 'fire', cells: [{ x: 3, y: 1 }] }, seq);
    for (const seat of ['a', 'b'] as const) {
      const sunk = eventsFor(sinking, seat).find((event) => event.type === 'ship_sunk');
      expect(sunk?.type === 'ship_sunk' && sunk.outline).toHaveLength(4);
    }
  });
});

describe('ownership (spec §10)', () => {
  it('produces no payload at all for a player with no seat', () => {
    const outcome = send(startedSession(), 'not-in-this-game', { type: 'ready' }, 0);

    expect(outcome.error?.code).toBe('not_a_participant');
    expect(outcome.events).toEqual({ a: [], b: [] });
  });

  it('does not let one seat receive the other seat’s events', () => {
    const outcome = send(
      startedSession(),
      playerIdOf('a'),
      { type: 'fire', cells: [{ x: 0, y: 1 }] },
      1,
    );

    const forA = eventsFor(outcome, 'a').find((event) => event.type === 'state_snapshot');
    const forB = eventsFor(outcome, 'b').find((event) => event.type === 'state_snapshot');

    expect(forA?.type === 'state_snapshot' && forA.view.viewer).toBe('a');
    expect(forB?.type === 'state_snapshot' && forB.view.viewer).toBe('b');
    // Distinct objects, each filtered for its own recipient.
    expect(forA).not.toBe(forB);
  });
});
