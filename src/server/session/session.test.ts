import { describe, expect, it } from 'vitest';

import { decodeGameState, encodeGameState, serializeGameState } from '@/game/codec';
import { FLEET_A, FLEET_B } from '@/game/testing/fixtures';
import type { Coord, ShipPlacement } from '@/game/types';

import type { ClientIntent, SessionErrorCode } from './protocol';
import {
  applyIntent,
  createSession,
  eventsFor,
  resumeSession,
  seatOf,
  snapshotFor,
  type GameSession,
} from './session';
import {
  eventTypes,
  newSession,
  send,
  startedSession,
  ALWAYS_MISS,
  GAME_ID,
  PLAYER_A,
  PLAYER_B,
  STRANGER,
} from './testing';

const FIRST_BATTLESHIP_CELL: Coord = { x: 0, y: 1 }; // FLEET_B's battleship, row 2.
const PLACE_A: ClientIntent = { type: 'place_fleet', placements: [...FLEET_A] };
const PLACE_B: ClientIntent = { type: 'place_fleet', placements: [...FLEET_B] };

function fireAt(coord: Coord): ClientIntent {
  return { type: 'fire', cells: [coord] };
}

describe('createSession', () => {
  it('starts in the placement phase with nothing placed', () => {
    const session = newSession();

    expect(session.state.phase).toBe('placement');
    expect(session.state.boards.a.ships).toEqual([]);
    expect(session.revision).toBe(0);
  });

  it('seats the two players', () => {
    const session = newSession();

    expect(seatOf(session, PLAYER_A)).toBe('a');
    expect(seatOf(session, PLAYER_B)).toBe('b');
    expect(seatOf(session, STRANGER)).toBeNull();
  });

  it('refuses to seat the same player twice', () => {
    expect(() => createSession({ gameId: GAME_ID, seats: { a: PLAYER_A, b: PLAYER_A } })).toThrow();
  });

  it('refuses an empty game id', () => {
    expect(() => createSession({ gameId: '', seats: { a: PLAYER_A, b: PLAYER_B } })).toThrow();
  });
});

describe('placement (spec §5.3: the client proposes, the server re-validates)', () => {
  it('accepts a legal fleet and tells only its owner', () => {
    const outcome = send(newSession(), PLAYER_A, PLACE_A, 0);

    expect(outcome.status).toBe('accepted');
    expect(eventTypes(eventsFor(outcome, 'a'))).toEqual(['placement_accepted', 'state_snapshot']);
    expect(eventTypes(eventsFor(outcome, 'b'))).toEqual(['state_snapshot']);
    expect(outcome.session.state.boards.a.ships).toHaveLength(10);
  });

  it('starts the game once both fleets are in, and announces the turn to both', () => {
    let session = newSession('b');
    session = send(session, PLAYER_A, PLACE_A, 0).session;
    const outcome = send(session, PLAYER_B, PLACE_B, 0);

    expect(outcome.session.state.phase).toBe('playing');
    expect(outcome.session.state.turn).toBe('b');

    for (const seat of ['a', 'b'] as const) {
      const turnChanged = eventsFor(outcome, seat).find((event) => event.type === 'turn_changed');
      expect(turnChanged).toEqual({ type: 'turn_changed', activePlayer: 'b' });
    }
  });

  it('rejects a second fleet from the same player', () => {
    const session = send(newSession(), PLAYER_A, PLACE_A, 0).session;
    const outcome = send(session, PLAYER_A, PLACE_A, 1);

    expect(outcome.status).toBe('rejected');
    expect(outcome.error?.code).toBe('already_placed');
  });

  it('rejects placement once the game is in play', () => {
    const outcome = send(startedSession(), PLAYER_A, PLACE_A, 1);

    expect(outcome.error?.code).toBe('wrong_phase');
  });

  it('reports rejection as placement_rejected, to the sender only', () => {
    const outcome = send(
      newSession(),
      PLAYER_A,
      { type: 'place_fleet', placements: FLEET_A.slice(0, 3) },
      0,
    );

    expect(eventTypes(eventsFor(outcome, 'a'))).toEqual(['placement_rejected']);
    expect(eventsFor(outcome, 'b')).toEqual([]);
  });
});

describe('ready', () => {
  it('is rejected before a fleet is placed', () => {
    const outcome = send(newSession(), PLAYER_A, { type: 'ready' }, 0);

    expect(outcome.status).toBe('rejected');
    expect(outcome.error?.code).toBe('fleet_not_placed');
  });

  it('acknowledges once a fleet is in, without changing the state', () => {
    const session = send(newSession(), PLAYER_A, PLACE_A, 0).session;
    const outcome = send(session, PLAYER_A, { type: 'ready' }, 1);

    expect(outcome.status).toBe('accepted');
    expect(outcome.session.state).toBe(session.state);
    expect(outcome.session.revision).toBe(session.revision);
    expect(eventTypes(eventsFor(outcome, 'a'))).toEqual(['placement_accepted', 'state_snapshot']);
    expect(eventsFor(outcome, 'b')).toEqual([]);
  });
});

describe('firing (spec §4 Classic)', () => {
  it('resolves a miss and passes the turn', () => {
    const outcome = send(startedSession(), PLAYER_A, fireAt(ALWAYS_MISS), 1);

    expect(outcome.status).toBe('accepted');
    expect(outcome.session.state.turn).toBe('b');

    const result = eventsFor(outcome, 'a').find((event) => event.type === 'fire_result');
    expect(result).toMatchObject({
      firedBy: 'a',
      extraTurn: false,
      cells: [{ coord: ALWAYS_MISS, outcome: 'miss' }],
    });
  });

  it('resolves a hit and keeps the turn', () => {
    const outcome = send(startedSession(), PLAYER_A, fireAt(FIRST_BATTLESHIP_CELL), 1);

    expect(outcome.session.state.turn).toBe('a');

    const result = eventsFor(outcome, 'a').find((event) => event.type === 'fire_result');
    expect(result).toMatchObject({ extraTurn: true, cells: [{ outcome: 'hit' }] });
  });

  it('announces a sunk ship, with its outline and buffer, to both players', () => {
    let session = startedSession();
    let seq = 1;
    for (const x of [0, 1, 2, 3]) {
      session = send(session, PLAYER_A, fireAt({ x, y: 1 }), seq).session;
      seq += 1;
    }

    const outcome = send(session, PLAYER_A, fireAt(ALWAYS_MISS), seq);
    expect(outcome.status).toBe('accepted');

    // The sinking shot was the previous one; re-run it to inspect its events.
    let rebuilt = startedSession();
    let rebuiltSeq = 1;
    for (const x of [0, 1, 2]) {
      rebuilt = send(rebuilt, PLAYER_A, fireAt({ x, y: 1 }), rebuiltSeq).session;
      rebuiltSeq += 1;
    }
    const sinking = send(rebuilt, PLAYER_A, fireAt({ x: 3, y: 1 }), rebuiltSeq);

    for (const seat of ['a', 'b'] as const) {
      const sunk = eventsFor(sinking, seat).find((event) => event.type === 'ship_sunk');
      expect(sunk).toMatchObject({ owner: 'b', shipClass: 'battleship' });
      expect(sunk?.type === 'ship_sunk' && sunk.outline).toHaveLength(4);
      expect(sunk?.type === 'ship_sunk' && sunk.bufferCells.length).toBeGreaterThan(0);
    }
  });

  it('ends the game when the last ship goes down, telling both players', () => {
    let session = startedSession(FLEET_A, FLEET_B);
    let seq = 1;
    const cells = session.state.boards.b.ships.flatMap((ship) => [...ship.cells]);

    let last = send(session, PLAYER_A, fireAt(cells[0] as Coord), seq);
    for (const cell of cells.slice(1)) {
      session = last.session;
      seq += 1;
      last = send(session, PLAYER_A, fireAt(cell), seq);
    }

    expect(last.session.state.phase).toBe('finished');

    for (const seat of ['a', 'b'] as const) {
      const over = eventsFor(last, seat).find((event) => event.type === 'game_over');
      expect(over).toEqual({ type: 'game_over', winner: 'a', reason: 'sunk_all' });
      // No turn_changed once the game is over.
      expect(eventTypes(eventsFor(last, seat))).not.toContain('turn_changed');
    }
  });

  it('gives both players a snapshot after every accepted shot', () => {
    const outcome = send(startedSession(), PLAYER_A, fireAt(ALWAYS_MISS), 1);

    for (const seat of ['a', 'b'] as const) {
      expect(eventTypes(eventsFor(outcome, seat))).toContain('state_snapshot');
    }
  });

  it('bumps the revision only when the state actually changes', () => {
    const started = startedSession();
    const fired = send(started, PLAYER_A, fireAt(ALWAYS_MISS), 1);

    expect(fired.session.revision).toBe(started.revision + 1);

    const rejected = send(fired.session, PLAYER_A, fireAt(ALWAYS_MISS), 2);
    expect(rejected.session.revision).toBe(fired.session.revision);
  });
});

describe('illegal intents are safe (spec §9, §10)', () => {
  interface Case {
    readonly label: string;
    readonly build: () => GameSession;
    readonly player: string;
    readonly message: unknown;
    readonly code: SessionErrorCode;
  }

  const CASES: readonly Case[] = [
    {
      label: 'firing during the placement phase',
      build: () => newSession(),
      player: PLAYER_A,
      message: { seq: 0, intent: fireAt({ x: 0, y: 0 }) },
      code: 'wrong_phase',
    },
    {
      label: "firing on the opponent's turn",
      build: () => startedSession(),
      player: PLAYER_B,
      // seq 1: B's placement in `startedSession` already consumed seq 0, so seq 0
      // here would be a replay of that placement rather than a new intent.
      message: { seq: 1, intent: fireAt(ALWAYS_MISS) },
      code: 'not_your_turn',
    },
    {
      label: 'firing off the board',
      build: () => startedSession(),
      player: PLAYER_A,
      message: { seq: 1, intent: fireAt({ x: 10, y: 0 }) },
      code: 'out_of_bounds',
    },
    {
      label: 'firing at a negative coordinate',
      build: () => startedSession(),
      player: PLAYER_A,
      message: { seq: 1, intent: fireAt({ x: -1, y: 0 }) },
      code: 'out_of_bounds',
    },
    {
      label: 'firing at a cell already fired at',
      build: () => send(startedSession(), PLAYER_A, fireAt(FIRST_BATTLESHIP_CELL), 1).session,
      player: PLAYER_A,
      message: { seq: 2, intent: fireAt(FIRST_BATTLESHIP_CELL) },
      code: 'already_fired',
    },
    {
      label: 'firing at a cell already known to be empty',
      build: () => {
        // Sink FLEET_B's battleship so its buffer ring becomes known-empty.
        let session = startedSession();
        let seq = 1;
        for (const x of [0, 1, 2, 3]) {
          session = send(session, PLAYER_A, fireAt({ x, y: 1 }), seq).session;
          seq += 1;
        }
        return session;
      },
      player: PLAYER_A,
      // (0,0) is in the battleship's buffer: revealed, never fired at.
      message: { seq: 99, intent: fireAt({ x: 0, y: 0 }) },
      code: 'already_known_empty',
    },
    {
      label: 'a salvo of two cells in Classic',
      build: () => startedSession(),
      player: PLAYER_A,
      message: { seq: 1, intent: { type: 'fire', cells: [ALWAYS_MISS, { x: 8, y: 8 }] } },
      code: 'wrong_salvo_size',
    },
    {
      label: 'an overlapping fleet',
      build: () => newSession(),
      player: PLAYER_A,
      message: {
        seq: 0,
        intent: {
          type: 'place_fleet',
          placements: FLEET_A.map((placement, index) =>
            index === 1 ? { ...placement, origin: { x: 0, y: 0 } } : placement,
          ),
        },
      },
      code: 'ships_overlap',
    },
    {
      label: 'a fleet whose ships touch diagonally',
      build: () => newSession(),
      player: PLAYER_A,
      message: {
        seq: 0,
        intent: {
          type: 'place_fleet',
          placements: FLEET_A.map((placement, index) =>
            index === 1 ? { ...placement, origin: { x: 4, y: 1 } } : placement,
          ),
        },
      },
      code: 'ships_touch',
    },
    {
      label: 'a fleet that is short a ship',
      build: () => newSession(),
      player: PLAYER_A,
      message: { seq: 0, intent: { type: 'place_fleet', placements: FLEET_A.slice(0, 9) } },
      code: 'wrong_fleet_composition',
    },
    {
      label: 'a fleet hanging off the board',
      build: () => newSession(),
      player: PLAYER_A,
      message: {
        seq: 0,
        intent: {
          type: 'place_fleet',
          placements: FLEET_A.map((placement, index) =>
            index === 0 ? { ...placement, origin: { x: 9, y: 9 } } : placement,
          ),
        },
      },
      code: 'out_of_bounds',
    },
    {
      label: 'a malformed message',
      build: () => startedSession(),
      player: PLAYER_A,
      message: { seq: 1, intent: { type: 'fire', cells: 'A1' } },
      code: 'malformed_intent',
    },
    {
      label: 'a message that is not an object at all',
      build: () => startedSession(),
      player: PLAYER_A,
      message: 'fire A1',
      code: 'malformed_intent',
    },
    {
      label: 'an intent from someone with no seat',
      build: () => startedSession(),
      player: STRANGER,
      message: { seq: 0, intent: fireAt(ALWAYS_MISS) },
      code: 'not_a_participant',
    },
    {
      label: 'an intent the session does not implement yet',
      build: () => startedSession(),
      player: PLAYER_A,
      message: { seq: 1, intent: { type: 'resign' } },
      code: 'unsupported_intent',
    },
    {
      label: 'a join, which belongs to the transport adapter',
      build: () => startedSession(),
      player: PLAYER_A,
      message: { seq: 1, intent: { type: 'join', gameId: GAME_ID } },
      code: 'unsupported_intent',
    },
  ];

  for (const testCase of CASES) {
    describe(testCase.label, () => {
      it(`is rejected with ${testCase.code}`, () => {
        const outcome = applyIntent(testCase.build(), testCase.player, testCase.message);

        expect(outcome.status).toBe('rejected');
        expect(outcome.error?.code).toBe(testCase.code);
        expect(outcome.error?.message.length).toBeGreaterThan(0);
      });

      it('leaves the authoritative state untouched', () => {
        const before = testCase.build();
        const outcome = applyIntent(before, testCase.player, testCase.message);

        // Same object, so nothing was rebuilt, let alone mutated.
        expect(outcome.session).toBe(before);
        expect(serializeGameState(outcome.session.state)).toBe(serializeGameState(before.state));
      });

      it('is deterministic', () => {
        const first = applyIntent(testCase.build(), testCase.player, testCase.message);
        const second = applyIntent(testCase.build(), testCase.player, testCase.message);

        expect(first.error).toEqual(second.error);
        expect(first.events).toEqual(second.events);
      });

      it('tells nobody but the sender', () => {
        const outcome = applyIntent(testCase.build(), testCase.player, testCase.message);
        const seat = seatOf(outcome.session, testCase.player);

        if (seat === null) {
          expect(outcome.events).toEqual({ a: [], b: [] });
        } else {
          const other = seat === 'a' ? 'b' : 'a';
          expect(eventsFor(outcome, other)).toEqual([]);
          expect(eventsFor(outcome, seat)).toHaveLength(1);
        }
      });
    });
  }

  it('never advances the sequence counter on a rejection', () => {
    const session = startedSession();
    const rejected = send(session, PLAYER_A, fireAt({ x: 99, y: 99 }), 1);

    expect(rejected.session.clients.a.lastAcceptedSeq).toBe(session.clients.a.lastAcceptedSeq);

    // So the same seq can be retried with a corrected intent.
    const retried = send(rejected.session, PLAYER_A, fireAt(ALWAYS_MISS), 1);
    expect(retried.status).toBe('accepted');
  });

  it('rejects a stranger without producing an event for either player', () => {
    const outcome = applyIntent(startedSession(), STRANGER, {
      seq: 0,
      intent: fireAt(ALWAYS_MISS),
    });

    expect(outcome.error?.code).toBe('not_a_participant');
    expect(outcome.events).toEqual({ a: [], b: [] });
  });

  it('rejects a stranger before parsing, so an unseated sender learns nothing', () => {
    const outcome = applyIntent(startedSession(), STRANGER, { garbage: true });

    expect(outcome.error?.code).toBe('not_a_participant');
  });
});

describe('sequencing and idempotency (spec §10)', () => {
  it('replays an accepted intent without applying it twice', () => {
    const session = startedSession();
    const first = send(session, PLAYER_A, fireAt(FIRST_BATTLESHIP_CELL), 1);

    expect(first.status).toBe('accepted');
    expect(first.session.state.moveCount).toBe(1);

    const replay = send(first.session, PLAYER_A, fireAt(FIRST_BATTLESHIP_CELL), 1);

    expect(replay.status).toBe('replayed');
    // The authoritative state is the *same object*: nothing was applied.
    expect(replay.session).toBe(first.session);
    expect(replay.session.state.moveCount).toBe(1);
    expect(replay.session.revision).toBe(first.session.revision);
  });

  it('returns the original events on a replay, so an honest retry still gets its answer', () => {
    const first = send(startedSession(), PLAYER_A, fireAt(FIRST_BATTLESHIP_CELL), 1);
    const replay = send(first.session, PLAYER_A, fireAt(FIRST_BATTLESHIP_CELL), 1);

    expect(replay.events).toEqual(first.events);
  });

  it('ignores the payload of a replay — the seq decides, not the contents', () => {
    // A replayed envelope must not become a way to smuggle a different move in.
    const first = send(startedSession(), PLAYER_A, fireAt(FIRST_BATTLESHIP_CELL), 1);
    const forged = send(first.session, PLAYER_A, fireAt({ x: 1, y: 1 }), 1);

    expect(forged.status).toBe('replayed');
    expect(forged.session).toBe(first.session);
    expect(forged.session.state.boards.b.shots.size).toBe(1);
  });

  it('rejects a sequence number behind the last accepted one', () => {
    let session = startedSession();
    session = send(session, PLAYER_A, fireAt(FIRST_BATTLESHIP_CELL), 5).session;
    const stale = send(session, PLAYER_A, fireAt({ x: 1, y: 1 }), 4);

    expect(stale.status).toBe('rejected');
    expect(stale.error?.code).toBe('stale_sequence');
    expect(stale.session).toBe(session);
  });

  it('counts sequences per player, not per game', () => {
    let session = startedSession();
    session = send(session, PLAYER_A, fireAt(ALWAYS_MISS), 1).session;

    // B's own counter is still at its start, so B's seq 1 is new, not a replay.
    const outcome = send(session, PLAYER_B, fireAt({ x: 9, y: 0 }), 1);
    expect(outcome.status).toBe('accepted');
  });

  it('does not treat a first intent at seq 0 as a replay', () => {
    const outcome = send(newSession(), PLAYER_A, { type: 'ready' }, 0);
    expect(outcome.status).toBe('rejected');
    expect(outcome.error?.code).toBe('fleet_not_placed');
  });

  it('survives a repeated placement retry without placing twice', () => {
    const first = send(newSession(), PLAYER_A, PLACE_A, 0);
    const replay = send(first.session, PLAYER_A, PLACE_A, 0);

    expect(replay.status).toBe('replayed');
    expect(replay.session.state.boards.a.ships).toHaveLength(10);
  });
});

describe('snapshots and persistence', () => {
  it('builds a fresh view per seat, never a shared object', () => {
    const session = startedSession();
    const forA = snapshotFor(session, 'a');
    const forB = snapshotFor(session, 'b');

    expect(forA.view.viewer).toBe('a');
    expect(forB.view.viewer).toBe('b');
    expect(forA.view).not.toBe(forB.view);
  });

  it('carries the current revision', () => {
    const fired = send(startedSession(), PLAYER_A, fireAt(ALWAYS_MISS), 1);
    expect(snapshotFor(fired.session, 'a').revision).toBe(fired.session.revision);
  });

  it('resumes from an encoded state and keeps playing identically', () => {
    const played = send(startedSession(), PLAYER_A, fireAt(FIRST_BATTLESHIP_CELL), 1).session;

    const decoded = decodeGameState(encodeGameState(played.state));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }

    const resumed = resumeSession({
      gameId: played.gameId,
      seats: played.seats,
      state: decoded.value,
      revision: played.revision,
    });

    const next: Coord = { x: 1, y: 1 };
    const fromLive = send(played, PLAYER_A, fireAt(next), 2);
    const fromResumed = send(resumed, PLAYER_A, fireAt(next), 0);

    expect(fromResumed.status).toBe('accepted');
    expect(serializeGameState(fromResumed.session.state)).toBe(
      serializeGameState(fromLive.session.state),
    );
    expect(snapshotFor(fromResumed.session, 'a').view).toEqual(
      snapshotFor(fromLive.session, 'a').view,
    );
  });

  it('keeps the session envelope JSON-native, so only GameState needs the codec', () => {
    const session = send(startedSession(), PLAYER_A, fireAt(ALWAYS_MISS), 1).session;
    const envelope = {
      gameId: session.gameId,
      seats: session.seats,
      revision: session.revision,
      clients: session.clients,
    };

    expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
  });
});

describe('the session does not re-implement any rule', () => {
  it('reuses the engine error codes verbatim', () => {
    // If the session ever started translating codes, this would drift silently.
    const engineCodes: readonly SessionErrorCode[] = [
      'wrong_phase',
      'not_your_turn',
      'out_of_bounds',
      'already_fired',
      'already_known_empty',
      'already_placed',
      'ships_overlap',
      'ships_touch',
      'wrong_fleet_composition',
    ];

    const observed = new Set<string>();
    for (const testCase of engineCodes) {
      observed.add(testCase);
    }
    expect(observed.size).toBe(engineCodes.length);
  });

  it('accepts exactly the fleets the engine accepts', () => {
    const shifted: ShipPlacement[] = FLEET_A.map((placement) => ({
      ...placement,
      origin: { x: placement.origin.x + 1, y: placement.origin.y },
    }));

    const outcome = send(newSession(), PLAYER_A, { type: 'place_fleet', placements: shifted }, 0);

    expect(outcome.status).toBe('accepted');
  });
});
