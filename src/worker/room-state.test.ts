import { describe, expect, it } from 'vitest';

import { encodeGameState, serializeGameState } from '@/game/codec';
import { FLEET_A, FLEET_B } from '@/game/testing/fixtures';
import { fireAll, startedGame } from '@/game/testing/harness';
import { applyIntent } from '@/server/session/session';

import {
  encodeRoom,
  restoreRoom,
  startSession,
  EMPTY_ROOM,
  ROOM_STATE_VERSION,
} from './room-state';

const GAME_ID = 'game-under-test';
const SEATS = { a: 'player-a', b: 'player-b' };

function playedSession() {
  const session = startSession(GAME_ID, SEATS);
  return {
    ...session,
    state: fireAll(startedGame(FLEET_A, FLEET_B), 'a', [{ x: 9, y: 9 }]),
  };
}

describe('a room with no stored state', () => {
  it('starts empty rather than failing', () => {
    const restored = restoreRoom(undefined, GAME_ID);

    expect(restored.ok).toBe(true);
    expect(restored.ok && restored.room).toEqual(EMPTY_ROOM(GAME_ID));
    expect(restored.ok && restored.session).toBeNull();
  });

  it('treats null the same way', () => {
    expect(restoreRoom(null, GAME_ID).ok).toBe(true);
  });
});

describe('round trip', () => {
  it('restores a match to the same authoritative state', () => {
    const session = playedSession();
    const encoded = encodeRoom({
      gameId: GAME_ID,
      seats: SEATS,
      session,
      seq: { a: 3, b: 1 },
    });

    const restored = restoreRoom(JSON.parse(JSON.stringify(encoded)), GAME_ID);

    expect(restored.ok).toBe(true);
    if (!restored.ok || !restored.session) {
      return;
    }
    expect(serializeGameState(restored.session.state)).toBe(serializeGameState(session.state));
    expect(restored.session.seats).toEqual(SEATS);
  });

  it('restores replay protection, so an old intent is not applied twice', () => {
    // The dangerous case: a hibernating Durable Object loses its in-memory session
    // between messages (spec §10).
    const session = playedSession();
    const encoded = encodeRoom({ gameId: GAME_ID, seats: SEATS, session, seq: { a: 4, b: -1 } });
    const restored = restoreRoom(JSON.parse(JSON.stringify(encoded)), GAME_ID);

    expect(restored.ok && restored.session?.clients.a.lastAcceptedSeq).toBe(4);

    if (!restored.ok || !restored.session) {
      return;
    }
    const replay = applyIntent(restored.session, SEATS.a, {
      seq: 4,
      intent: { type: 'fire', cells: [{ x: 8, y: 8 }] },
    });

    expect(replay.status).toBe('replayed');
    expect(replay.session).toBe(restored.session);
  });

  it('leaves a seat that has accepted nothing with no cached response', () => {
    const session = playedSession();
    const encoded = encodeRoom({ gameId: GAME_ID, seats: SEATS, session, seq: { a: 4, b: -1 } });
    const restored = restoreRoom(JSON.parse(JSON.stringify(encoded)), GAME_ID);

    expect(restored.ok && restored.session?.clients.b.lastEvents).toBeNull();
  });

  it('keeps a half-seated room, where only one player has connected', () => {
    const encoded = encodeRoom({
      gameId: GAME_ID,
      seats: { a: 'player-a' },
      session: null,
      seq: { a: -1, b: -1 },
    });

    const restored = restoreRoom(JSON.parse(JSON.stringify(encoded)), GAME_ID);

    expect(restored.ok && restored.room.seats).toEqual({ a: 'player-a' });
    expect(restored.ok && restored.session).toBeNull();
  });

  it('survives JSON, which is what durable storage round-trips through', () => {
    const session = playedSession();
    const encoded = encodeRoom({ gameId: GAME_ID, seats: SEATS, session, seq: { a: 0, b: 0 } });

    expect(JSON.parse(JSON.stringify(encoded))).toEqual(encoded);
  });
});

describe('a corrupt or tampered room is refused, not guessed at', () => {
  const valid = () =>
    JSON.parse(
      JSON.stringify(
        encodeRoom({
          gameId: GAME_ID,
          seats: SEATS,
          session: playedSession(),
          seq: { a: 0, b: 0 },
        }),
      ),
    ) as Record<string, unknown>;

  it('refuses an unknown version', () => {
    const restored = restoreRoom({ ...valid(), v: 99 }, GAME_ID);
    expect(restored.ok).toBe(false);
  });

  it('refuses a non-object', () => {
    expect(restoreRoom('nope', GAME_ID).ok).toBe(false);
  });

  it('refuses game state without both seats', () => {
    const restored = restoreRoom({ ...valid(), seats: { a: 'player-a' } }, GAME_ID);
    expect(restored.ok).toBe(false);
  });

  it('refuses a game state that fails the Block 1 codec', () => {
    const base = valid();
    const state = base.state as ReturnType<typeof encodeGameState>;
    const restored = restoreRoom({ ...base, state: { ...state, phase: 'lobby' } }, GAME_ID);

    expect(restored.ok).toBe(false);
    expect(!restored.ok && restored.reason).toContain('invalid');
  });

  it('refuses a tampered fleet — the codec re-validates both boards', () => {
    // A room blob cannot smuggle an illegal board back into a live match.
    const base = valid();
    const state = base.state as ReturnType<typeof encodeGameState>;
    const ships = state.boards.a.ships.map((ship, index) =>
      index === 1 ? { ...ship, origin: { x: 0, y: 0 } } : ship,
    );

    const restored = restoreRoom(
      {
        ...base,
        state: { ...state, boards: { ...state.boards, a: { ...state.boards.a, ships } } },
      },
      GAME_ID,
    );

    expect(restored.ok).toBe(false);
  });

  it('falls back to no sequencing rather than trusting a malformed seq', () => {
    const restored = restoreRoom({ ...valid(), seq: { a: 'nope', b: 1.5 } }, GAME_ID);

    expect(restored.ok && restored.session?.clients.a.lastAcceptedSeq).toBe(-1);
    expect(restored.ok && restored.session?.clients.b.lastAcceptedSeq).toBe(-1);
  });
});

describe('startSession', () => {
  it('stamps the version and starts in placement', () => {
    const session = startSession(GAME_ID, SEATS);

    expect(session.state.phase).toBe('placement');
    expect(session.seats).toEqual(SEATS);
    expect(EMPTY_ROOM(GAME_ID).v).toBe(ROOM_STATE_VERSION);
  });

  it('draws the first turn from the runtime CSPRNG, not from the clients', () => {
    // Spec §9: the server owns all RNG. Over many draws both seats must appear.
    const draws = new Set(
      Array.from({ length: 60 }, () => startSession(GAME_ID, SEATS).state.firstTurn),
    );

    expect(draws.size).toBe(2);
  });
});
