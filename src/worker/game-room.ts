/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';

import type { PlayerSlot } from '@/game/types';
import {
  applyIntent,
  seatOf,
  snapshotFor,
  type GameSession,
  type SessionEvents,
} from '@/server/session/session';
import { parseClientMessage, type ServerEvent } from '@/server/session/protocol';
import { verifyGameTicket } from '@/server/ticket';

import {
  encodeRoom,
  restoreRoom,
  startSession,
  type PersistedRoom,
  type RoomSeats,
} from './room-state';
import type { Env } from './env';

const ROOM_KEY = 'room';

/** Attached to each socket so the seat survives hibernation. */
interface SocketIdentity {
  readonly seat: PlayerSlot;
  readonly playerId: string;
}

/**
 * One live match (spec §5.1: "one authoritative actor per live game").
 *
 * The Durable Object is the transport and the owner of the state; every Battleship
 * decision is delegated to the Block 1 `GameSession`, which delegates to `src/game`.
 * Nothing here re-implements a rule, and nothing here builds a payload for a player —
 * per-recipient filtering is `GameSession`'s, and this class only routes what it is
 * handed to the socket it belongs to.
 *
 * Hibernation is on: sockets are accepted with `ctx.acceptWebSocket`, so the runtime
 * may evict this object from memory between messages while the connections stay open.
 * Everything therefore rehydrates from durable storage on each entry point, which is
 * also what makes a restart indistinguishable from an eviction.
 */
export class GameRoom extends DurableObject<Env> {
  /** Cached only for the lifetime of one in-memory instance; storage is the truth. */
  private room: PersistedRoom | null = null;
  private session: GameSession | null = null;

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    const url = new URL(request.url);
    const token = url.searchParams.get('ticket') ?? '';
    const gameId = url.searchParams.get('gameId') ?? '';

    const ticket = await verifyGameTicket(token, this.env.GAME_TICKET_SECRET ?? '');
    if (!ticket.ok) {
      // Deliberately terse: the client learns the category, never which check failed
      // beyond that, and no ticket contents are echoed.
      return new Response(ticket.error.code, { status: 401 });
    }

    // The ticket names the game it is for; a ticket for another room is not usable here
    // even though the routing already picked this object by id.
    if (gameId !== '' && ticket.claims.gameId !== gameId) {
      return new Response('ticket_game_mismatch', { status: 403 });
    }

    const bound = await this.bindSeat(
      ticket.claims.gameId,
      ticket.claims.seat,
      ticket.claims.playerId,
    );
    if (!bound.ok) {
      return new Response(bound.reason, { status: 409 });
    }

    const pair = new WebSocketPair();
    const client = pair[0] as WebSocket;
    const server = pair[1] as WebSocket;

    // Tagged by seat so the other side can be found again after hibernation.
    this.ctx.acceptWebSocket(server, [ticket.claims.seat]);
    const identity: SocketIdentity = {
      seat: ticket.claims.seat,
      playerId: ticket.claims.playerId,
    };
    server.serializeAttachment(identity);

    // A fresh snapshot on every connect is what makes reconnection safe: the client is
    // never asked to reconcile, it is simply told the authoritative truth.
    if (this.session) {
      this.sendTo(server, snapshotFor(this.session, ticket.claims.seat));
    } else {
      this.sendTo(server, {
        type: 'error',
        code: 'unsupported_intent',
        message: 'Waiting for the other player to connect',
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handles one client frame.
   *
   * Order matters: rehydrate, identify the socket, validate the payload, then hand the
   * intent to `GameSession`. Nothing is trusted before the last step, and the seat used
   * is the one this object recorded — never one the message claims.
   */
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.load();

    const identity = this.identityOf(ws);
    if (!identity) {
      this.sendTo(ws, {
        type: 'error',
        code: 'not_a_participant',
        message: 'This connection has no seat',
      });
      return;
    }

    if (typeof message !== 'string') {
      // Binary frames are not part of the §9 protocol.
      this.sendTo(ws, {
        type: 'error',
        code: 'malformed_intent',
        message: 'Expected a text frame',
      });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      this.sendTo(ws, {
        type: 'error',
        code: 'malformed_intent',
        message: 'Expected JSON',
      });
      return;
    }

    // One shared validator with the rest of the app — the transport adds no schema.
    const parsed = parseClientMessage(payload);
    if (!parsed.ok) {
      this.sendTo(ws, { type: 'error', code: parsed.error.code, message: parsed.error.message });
      return;
    }

    // Spec §9 lists `join` and `heartbeat`; Block 1 classified both as connection
    // lifecycle, which is exactly this layer. They never reach the session.
    if (parsed.message.intent.type === 'heartbeat') {
      return;
    }
    if (parsed.message.intent.type === 'join') {
      if (this.session) {
        this.sendTo(ws, snapshotFor(this.session, identity.seat));
      }
      return;
    }

    if (!this.session) {
      this.sendTo(ws, {
        type: 'error',
        code: 'wrong_phase',
        message: 'The game has not started yet',
      });
      return;
    }

    const outcome = applyIntent(this.session, identity.playerId, parsed.message);

    if (outcome.session !== this.session) {
      this.session = outcome.session;
      await this.persist();
    }

    this.broadcast(outcome.events);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Reconnection is simply a new connection presenting the same ticket, which is
    // answered with a fresh snapshot. Grace windows and disconnect forfeits are spec §4
    // timer work and belong to a later block.
    try {
      ws.close(code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed; nothing to do.
    }
  }

  override async webSocketError(): Promise<void> {
    // Nothing to clean up: authoritative state lives in storage, not on the socket.
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Rehydrates from durable storage. Cheap when the instance is still warm. */
  private async load(): Promise<void> {
    if (this.room) {
      return;
    }

    const raw = await this.ctx.storage.get<unknown>(ROOM_KEY);
    const restored = restoreRoom(raw, this.ctx.id.toString());

    if (!restored.ok) {
      // Refuse to serve a room we cannot trust rather than inventing a state.
      throw new Error(`game room state could not be restored: ${restored.reason}`);
    }

    this.room = restored.room;
    this.session = restored.session;
  }

  private async persist(): Promise<void> {
    const room = this.room;
    if (!room) {
      return;
    }

    const next = encodeRoom({
      gameId: room.gameId,
      seats: room.seats,
      session: this.session,
      seq: {
        a: this.session?.clients.a.lastAcceptedSeq ?? room.seq.a,
        b: this.session?.clients.b.lastAcceptedSeq ?? room.seq.b,
      },
    });

    this.room = next;
    await this.ctx.storage.put(ROOM_KEY, next);
  }

  /**
   * Records which player holds a seat, from the *signed* ticket.
   *
   * Only our own server can mint a ticket, so only our own server decides seating. A
   * seat already bound to a different player is refused rather than reassigned, so a
   * second ticket for the same seat cannot displace a player mid-match.
   */
  private async bindSeat(
    gameId: string,
    seat: PlayerSlot,
    playerId: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    await this.load();
    const room = this.room;
    if (!room) {
      return { ok: false, reason: 'room_unavailable' };
    }

    const existing = room.seats[seat];
    if (existing !== undefined && existing !== playerId) {
      return { ok: false, reason: 'seat_taken' };
    }

    const other: PlayerSlot = seat === 'a' ? 'b' : 'a';
    if (room.seats[other] === playerId) {
      return { ok: false, reason: 'already_seated' };
    }

    const seats: RoomSeats = { ...room.seats, [seat]: playerId };
    this.room = { ...room, gameId, seats };

    if (!this.session && seats.a !== undefined && seats.b !== undefined) {
      this.session = startSession(gameId, { a: seats.a, b: seats.b });
    }

    await this.persist();

    // Both seats just filled: tell whoever was already waiting.
    if (this.session && this.session.revision === 0) {
      for (const slot of ['a', 'b'] as const) {
        for (const socket of this.ctx.getWebSockets(slot)) {
          this.sendTo(socket, snapshotFor(this.session, slot));
        }
      }
    }

    return { ok: true };
  }

  private identityOf(ws: WebSocket): SocketIdentity | null {
    const attachment = ws.deserializeAttachment() as SocketIdentity | null;
    if (!attachment || (attachment.seat !== 'a' && attachment.seat !== 'b')) {
      return null;
    }

    // The seat is only honoured while this room still agrees the player holds it.
    if (!this.session) {
      return this.room?.seats[attachment.seat] === attachment.playerId ? attachment : null;
    }
    return seatOf(this.session, attachment.playerId) === attachment.seat ? attachment : null;
  }

  /**
   * Routes per-seat events to that seat's sockets, and only there.
   *
   * `GameSession` produces a separate list per recipient, each derived through
   * `createPlayerView`. This method never merges them, never broadcasts one list to
   * both seats, and never inspects their contents.
   */
  private broadcast(events: SessionEvents): void {
    for (const seat of ['a', 'b'] as const) {
      const forSeat = events[seat];
      if (forSeat.length === 0) {
        continue;
      }
      for (const socket of this.ctx.getWebSockets(seat)) {
        for (const event of forSeat) {
          this.sendTo(socket, event);
        }
      }
    }
  }

  private sendTo(ws: WebSocket, event: ServerEvent): void {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      // The socket went away between the lookup and the send; the client will get a
      // fresh snapshot when it reconnects.
    }
  }
}
