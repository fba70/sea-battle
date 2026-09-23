import type { PlayerSlot } from '@/game/types';
import type { MatchPool } from '@/lib/db/schema/game';

import { generateRoomCode, normaliseRoomCode } from './room-code';

/**
 * Private rooms and quick match (spec §7.4).
 *
 * The server decides everything that matters: who you are comes from the session, the
 * game id is generated here, and the seat is assigned here. Nothing in this module
 * accepts an identity, a seat or a game id from a caller's request body.
 *
 * ## Why this is not Upstash yet
 *
 * Spec §5.2 assigns the queue and the room registry to Redis. Both needs are really
 * one need — an *atomic* claim, so "the matcher never pairs one waiting player into
 * two games" — and Postgres gives that directly: joining a room is a conditional
 * update on the empty seat, and pairing deletes both queue rows or neither. The queue
 * shape stays deliberately Redis-like (pool key, rating, enqueue time) so §5.2's
 * sorted set can replace the store without changing anything here.
 */

export interface QueuedPlayer {
  readonly userId: string;
  readonly rating: number;
  readonly enqueuedAt: Date;
}

export interface LobbyPlayer {
  readonly id: string;
  /** Guests play unrated, in their own pool (spec §4, OQ-6). */
  readonly isAnonymous: boolean;
  readonly rating: number;
}

export interface Seating {
  readonly gameId: string;
  readonly seat: PlayerSlot;
}

export interface RoomSeating extends Seating {
  readonly code: string;
  /** False while the room is still waiting for its second player. */
  readonly ready: boolean;
}

export type JoinRoomFailure = 'invalid_code' | 'room_not_found' | 'room_full' | 'already_finished';

export type JoinRoomResult =
  | { readonly ok: true; readonly seating: RoomSeating }
  | { readonly ok: false; readonly reason: JoinRoomFailure };

export type QuickMatchResult =
  | { readonly status: 'queued'; readonly pool: MatchPool }
  | { readonly status: 'matched'; readonly seating: Seating };

/** The persistence this module needs. Implemented against Neon in `lobby-store.ts`. */
export interface LobbyStore {
  /** Fails when the code is taken, so the caller can retry with a new one. */
  createRoom(input: {
    code: string;
    hostId: string;
    rated: boolean;
  }): Promise<{ readonly gameId: string } | { readonly collision: true }>;

  findRoomByCode(code: string): Promise<{
    readonly gameId: string;
    readonly playerAId: string | null;
    readonly playerBId: string | null;
    readonly status: string;
  } | null>;

  /** Conditional claim of the empty seat; null when someone else got there first. */
  claimSecondSeat(input: {
    gameId: string;
    playerId: string;
  }): Promise<{ readonly gameId: string } | null>;

  enqueue(input: { playerId: string; pool: MatchPool; rating: number }): Promise<void>;

  /**
   * Claims two waiting players at once. Returns both rows, or none when nobody is
   * waiting. A single row means a concurrent matcher took the other one first — the
   * caller puts it straight back, so no player is ever silently dropped.
   */
  takePair(input: { playerId: string; pool: MatchPool }): Promise<readonly QueuedPlayer[]>;

  dequeue(playerId: string): Promise<void>;

  createMatch(input: {
    playerAId: string;
    playerBId: string;
    rated: boolean;
  }): Promise<{ readonly gameId: string }>;

  /** A game this player already holds a seat in, if any. */
  findSeat(input: { gameId: string; playerId: string }): Promise<Seating | null>;
}

/** Spec §4: guests are never rated, so they queue in their own pool. */
export function poolFor(player: LobbyPlayer): MatchPool {
  return player.isAnonymous ? 'unrated' : 'rated';
}

const MAX_CODE_ATTEMPTS = 5;

/**
 * Opens a private room and returns its code.
 *
 * Spec §4 makes private games unrated by default; the "rated if both registered"
 * toggle is a later decision and is deliberately not exposed here.
 */
export async function createRoom(store: LobbyStore, host: LobbyPlayer): Promise<RoomSeating> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = generateRoomCode();
    const created = await store.createRoom({ code, hostId: host.id, rated: false });

    if ('gameId' in created) {
      // The creator always takes seat A; the joiner takes seat B.
      return { gameId: created.gameId, seat: 'a', code, ready: false };
    }
  }

  throw new Error('could not allocate a free room code');
}

/**
 * Joins a room by code.
 *
 * Idempotent for someone who is already seated — reopening the link, or coming back
 * after a reload, returns the seat they already hold instead of refusing.
 */
export async function joinRoom(
  store: LobbyStore,
  player: LobbyPlayer,
  rawCode: string,
): Promise<JoinRoomResult> {
  const code = normaliseRoomCode(rawCode);
  if (code === null) {
    return { ok: false, reason: 'invalid_code' };
  }

  const room = await store.findRoomByCode(code);
  if (!room) {
    return { ok: false, reason: 'room_not_found' };
  }

  if (room.playerAId === player.id) {
    return {
      ok: true,
      seating: { gameId: room.gameId, seat: 'a', code, ready: room.playerBId !== null },
    };
  }
  if (room.playerBId === player.id) {
    return { ok: true, seating: { gameId: room.gameId, seat: 'b', code, ready: true } };
  }

  if (room.status !== 'live') {
    return { ok: false, reason: 'already_finished' };
  }
  if (room.playerBId !== null) {
    return { ok: false, reason: 'room_full' };
  }

  // Conditional on the seat still being empty, so two people opening the link at the
  // same moment cannot both become player B.
  const claimed = await store.claimSecondSeat({ gameId: room.gameId, playerId: player.id });
  if (!claimed) {
    return { ok: false, reason: 'room_full' };
  }

  return { ok: true, seating: { gameId: claimed.gameId, seat: 'b', code, ready: true } };
}

/**
 * Enqueues for a quick match, and pairs immediately if someone compatible is waiting.
 *
 * Called repeatedly while a client waits. Each call retries the pairing, so two
 * players who both arrived to an empty queue are matched on their next poll rather
 * than waiting for a separate matcher process.
 *
 * Spec §7.4's widening rating window is not implemented yet: it needs the pool to be
 * big enough for a window to exclude anyone, and the rating column is already stored
 * so it can be added without a migration.
 */
export async function quickMatch(
  store: LobbyStore,
  player: LobbyPlayer,
): Promise<QuickMatchResult> {
  const pool = poolFor(player);

  await store.enqueue({ playerId: player.id, pool, rating: player.rating });

  const pair = await store.takePair({ playerId: player.id, pool });

  if (pair.length !== 2) {
    // A single row means another matcher claimed our partner between the scan and the
    // delete. Put whoever we pulled out straight back rather than dropping them, and
    // let the next poll try again.
    for (const stranded of pair) {
      await store.enqueue({ playerId: stranded.userId, pool, rating: stranded.rating });
    }
    return { status: 'queued', pool };
  }

  // Seat order is decided here, never by a client: whoever waited longest takes seat A.
  // (Which seat moves first is a separate coin flip, made by the Durable Object.)
  const ordered = [...pair].sort(
    (left, right) => left.enqueuedAt.getTime() - right.enqueuedAt.getTime(),
  );
  const playerAId = (ordered[0] as QueuedPlayer).userId;
  const playerBId = (ordered[1] as QueuedPlayer).userId;

  const { gameId } = await store.createMatch({
    playerAId,
    playerBId,
    // Spec §4: only a quick match between two registered players is rated.
    rated: pool === 'rated',
  });

  return {
    status: 'matched',
    seating: { gameId, seat: playerAId === player.id ? 'a' : 'b' },
  };
}
