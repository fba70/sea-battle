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

  /**
   * The most recent unfinished quick match this player is seated in.
   *
   * Pairing removes both players from the queue, but only the matcher learns the
   * result from its own call — the other player is still polling. This is how they
   * find out.
   *
   * `resumableForMs` bounds how old such a game may be. A row stays `live` until the
   * realtime layer reports its result, so a report that never lands would otherwise
   * pin the player to a game that is long over: every attempt to start a new one
   * would hand them the dead game back, which looks exactly like a button that does
   * nothing. Past the window the game is abandoned by definition, so resuming it
   * could not be right in any case.
   */
  findActiveMatch(input: { playerId: string; resumableForMs: number }): Promise<Seating | null>;

  /**
   * Closes games that were left open and will never finish (spec §4).
   *
   * Returns how many rows it closed, which is only useful for tests and logs.
   */
  abortAbandonedGames(input: { olderThanMs: number; limit: number }): Promise<number>;
}

/**
 * How long a `live` row may sit untouched before it is written off.
 *
 * The case this exists for is a private room nobody ever joined: no Durable Object
 * ever woke for it, so no disconnect grace and no timer can ever apply, and the row
 * would otherwise hold its join code forever.
 *
 * Two hours is far longer than any game can actually last — with a 30-second move
 * clock and three strikes, the longest possible match is well under one — so this can
 * never close a game somebody is still playing.
 */
export const ABANDONED_GAME_AFTER_MS = 2 * 60 * 60 * 1000;

/** At most this many rows per sweep, so one run can never be a long-running write. */
const ABANDON_SWEEP_LIMIT = 200;

/**
 * Cleans up abandoned rooms (spec §4).
 *
 * Deliberately *not* called from any gameplay path. It used to ride along with room
 * creation, which meant opening a room silently rewrote unrelated rows — surprising
 * during ordinary play, and worse during a test run, where creating rooms is routine.
 * Housekeeping that changes data a player did not ask about belongs on its own
 * schedule, so this is driven by the maintenance route instead.
 *
 * Failures are swallowed: a sweep that cannot run is not an error worth propagating.
 */
export async function sweepAbandonedGames(store: LobbyStore): Promise<number> {
  try {
    return await store.abortAbandonedGames({
      olderThanMs: ABANDONED_GAME_AFTER_MS,
      limit: ABANDON_SWEEP_LIMIT,
    });
  } catch {
    return 0;
  }
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
  if (claimed) {
    return { ok: true, seating: { gameId: claimed.gameId, seat: 'b', code, ready: true } };
  }

  /**
   * The seat was filled between the read above and the claim — but not necessarily by
   * someone else. A single client can have two requests in flight (React mounts
   * effects twice in development, and a reconnecting page retries), and the loser of
   * that race used to be told the room was full even though it had just been seated.
   * Re-read before refusing.
   */
  const settled = await store.findRoomByCode(code);
  if (settled?.playerAId === player.id) {
    return {
      ok: true,
      seating: { gameId: settled.gameId, seat: 'a', code, ready: settled.playerBId !== null },
    };
  }
  if (settled?.playerBId === player.id) {
    return { ok: true, seating: { gameId: settled.gameId, seat: 'b', code, ready: true } };
  }

  return { ok: false, reason: 'room_full' };
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

  /**
   * Were we paired since the last poll?
   *
   * `takePair` removes both players from the queue, but only the caller that won the
   * race gets the result. Without this check the other player would re-queue on every
   * poll and never discover the game that was created for them.
   */
  const alreadyMatched = await store.findActiveMatch({
    playerId: player.id,
    // The same window that defines an abandoned game: past it, there is nothing
    // left to rejoin.
    resumableForMs: ABANDONED_GAME_AFTER_MS,
  });
  if (alreadyMatched) {
    return { status: 'matched', seating: alreadyMatched };
  }

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
