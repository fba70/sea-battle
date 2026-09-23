/**
 * What a `GameRoom` Durable Object keeps in durable storage, and how it turns back
 * into a live `GameSession`.
 *
 * A hibernating DO is evicted from memory while its sockets stay open, so this restore
 * path runs constantly — not only after a crash. Everything the room needs to answer
 * the next message has to survive here.
 *
 * SECURITY: the persisted state contains BOTH fleets. It lives in the DO's own storage,
 * which nothing outside the Durable Object can read, and is never sent to a client.
 */
import { decodeGameState, encodeGameState, type EncodedGameState } from '@/game/codec';
import type { PlayerSlot } from '@/game/types';
import {
  createSession,
  restoreSequencing,
  resumeSession,
  type GameSession,
} from '@/server/session/session';

export const ROOM_STATE_VERSION = 1;

/** Seats fill in one at a time, as signed tickets arrive. */
export interface RoomSeats {
  readonly a?: string;
  readonly b?: string;
}

export interface PersistedRoom {
  readonly v: number;
  readonly gameId: string;
  readonly seats: RoomSeats;
  /** Null until both seats are known and the session has been created. */
  readonly state: EncodedGameState | null;
  readonly revision: number;
  /** Last accepted client sequence per seat; -1 when nothing has been accepted. */
  readonly seq: Readonly<Record<PlayerSlot, number>>;
  /**
   * True once the Next app has acknowledged the finished match. Persisted so the
   * result is reported exactly once even across hibernation, and so a failed report
   * can be retried the next time this room wakes.
   */
  readonly reported: boolean;
}

export const EMPTY_ROOM = (gameId: string): PersistedRoom => ({
  v: ROOM_STATE_VERSION,
  gameId,
  seats: {},
  state: null,
  revision: 0,
  seq: { a: -1, b: -1 },
  reported: false,
});

export function encodeRoom(room: {
  gameId: string;
  seats: RoomSeats;
  session: GameSession | null;
  seq: Readonly<Record<PlayerSlot, number>>;
  reported?: boolean;
}): PersistedRoom {
  return {
    v: ROOM_STATE_VERSION,
    gameId: room.gameId,
    seats: room.seats,
    state: room.session ? encodeGameState(room.session.state) : null,
    revision: room.session?.revision ?? 0,
    seq: room.seq,
    reported: room.reported ?? false,
  };
}

export type RestoreResult =
  | { readonly ok: true; readonly room: PersistedRoom; readonly session: GameSession | null }
  | { readonly ok: false; readonly reason: string };

function isSeatId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Rebuilds the room from whatever was in storage, validating as it goes.
 *
 * The game state is decoded with the Block 1 codec, which re-runs both fleets through
 * `validateFleet`, so a corrupted or tampered blob cannot produce an illegal board.
 */
export function restoreRoom(raw: unknown, gameId: string): RestoreResult {
  if (raw === undefined || raw === null) {
    return { ok: true, room: EMPTY_ROOM(gameId), session: null };
  }

  if (typeof raw !== 'object') {
    return { ok: false, reason: 'stored room is not an object' };
  }

  const record = raw as Record<string, unknown>;
  if (record.v !== ROOM_STATE_VERSION) {
    return { ok: false, reason: `unsupported room version: ${String(record.v)}` };
  }

  const storedSeats = (record.seats ?? {}) as Record<string, unknown>;
  const seats: RoomSeats = {
    ...(isSeatId(storedSeats.a) ? { a: storedSeats.a } : {}),
    ...(isSeatId(storedSeats.b) ? { b: storedSeats.b } : {}),
  };

  const seqRecord = (record.seq ?? {}) as Record<string, unknown>;
  const seq: Record<PlayerSlot, number> = {
    a: typeof seqRecord.a === 'number' && Number.isInteger(seqRecord.a) ? seqRecord.a : -1,
    b: typeof seqRecord.b === 'number' && Number.isInteger(seqRecord.b) ? seqRecord.b : -1,
  };

  const revision = typeof record.revision === 'number' ? record.revision : 0;
  const room: PersistedRoom = {
    v: ROOM_STATE_VERSION,
    gameId,
    seats,
    state: (record.state ?? null) as EncodedGameState | null,
    revision,
    seq,
    reported: record.reported === true,
  };

  if (room.state === null) {
    return { ok: true, room, session: null };
  }

  if (seats.a === undefined || seats.b === undefined) {
    return { ok: false, reason: 'stored game state without both seats' };
  }

  const decoded = decodeGameState(room.state);
  if (!decoded.ok) {
    return { ok: false, reason: `stored game state is invalid: ${decoded.error.code}` };
  }

  const session = restoreSequencing(
    resumeSession({ gameId, seats: { a: seats.a, b: seats.b }, state: decoded.value, revision }),
    seq,
  );

  return { ok: true, room, session };
}

/**
 * Creates the session once both seats are bound.
 *
 * Spec §9: "server owns all timers and RNG" — which seat moves first is drawn here,
 * from the runtime's CSPRNG, and then fixed for the life of the game by persistence.
 */
export function startSession(gameId: string, seats: { a: string; b: string }): GameSession {
  const draw = new Uint8Array(1);
  crypto.getRandomValues(draw);
  const firstTurn: PlayerSlot = (draw[0] as number) % 2 === 0 ? 'a' : 'b';

  return createSession({ gameId, seats, firstTurn });
}
