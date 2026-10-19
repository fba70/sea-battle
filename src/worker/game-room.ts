/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';

import type { PlayerSlot } from '@/game/types';
import {
  advanceClock,
  applyIntent,
  nextWakeAt,
  noteDisconnected,
  noteReconnected,
  seatOf,
  snapshotFor,
  type GameSession,
  type SessionEvents,
} from '@/server/session/session';
import { parseClientMessage, type ServerEvent } from '@/server/session/protocol';
import { encodeGameState } from '@/game/codec';
import { RESULT_SIGNATURE_HEADER, signResultReport } from '@/server/result-report';
import { verifyGameTicket } from '@/server/ticket';

import {
  encodeRoom,
  restoreRoom,
  startSession,
  type PersistedRating,
  type PersistedRoom,
  type RoomSeats,
} from './room-state';
import type { Env } from './env';

const ROOM_KEY = 'room';

/**
 * The seed for the fleet placed when the placement clock runs out.
 *
 * SECURITY: drawn from the runtime's CSPRNG, never derived from the game id or the
 * revision. Both players know the game id, so a derived seed would let an opponent
 * reproduce the exact fleet the server placed for someone who ran out of time and
 * sink it without searching. Spec §9: "server owns all timers and RNG".
 *
 * Nothing is lost by not being reproducible — the fleet is persisted the moment it
 * is placed, so a restart reads it back rather than regenerating it.
 */
function autoPlaceSeed(): number {
  const draw = new Uint32Array(1);
  crypto.getRandomValues(draw);
  return draw[0] as number;
}

/** One seat's view of the rating report — never the opponent's numbers. */
function ratingEvent(rating: PersistedRating, seat: PlayerSlot): ServerEvent {
  const summary = seat === 'a' ? rating.a : rating.b;

  return {
    type: 'rating_applied',
    rated: rating.rated,
    ...(rating.rated && summary ? { summary } : {}),
  };
}

/** How long to wait before retrying a result report, and how many times to try. */
const RESULT_RETRY_MS = 60_000;
const MAX_RESULT_ATTEMPTS = 5;

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

    // Coming back inside the grace window resumes the match (spec §4): the clock
    // restarts with the time that was left on it and the opponent is told.
    if (this.session && this.session.clock.offlineSince[ticket.claims.seat] !== null) {
      const resumed = noteReconnected(this.session, ticket.claims.seat, Date.now());
      this.session = resumed.session;
      await this.persist();
      this.broadcast(resumed.events);
      await this.armAlarm();
    }

    // Opening a game whose result never reached the app is the moment to try again.
    // No-ops for anything unfinished or already reported.
    await this.reportResultIfFinished();

    // Spec §7.6's rating change, re-sent on every connect so a reload or a
    // reconnect does not lose it. Nothing is sent for a match still in play.
    this.sendRatingTo(server, ticket.claims.seat);

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

    // `Date.now()` is read here and handed in: the session itself never reads a clock,
    // so every deadline it sets is the server's and nothing a client sends can move it.
    const outcome = applyIntent(this.session, identity.playerId, parsed.message, Date.now());

    if (outcome.session !== this.session) {
      this.session = outcome.session;
      await this.persist();
      await this.armAlarm();
    }

    this.broadcast(outcome.events);

    // Players see the result immediately; persistence and rating happen behind them.
    await this.reportResultIfFinished();
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed; nothing to do.
    }

    await this.noteSocketGone(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    // Authoritative state lives in storage, so there is nothing to clean up — but a
    // socket that errored is a socket that is gone, and the grace window starts now.
    await this.noteSocketGone(ws);
  }

  /**
   * Starts the grace window once a seat has no live socket left (spec §4).
   *
   * A player may legitimately hold more than one connection for a moment — a reload
   * overlaps the old socket and the new one — so this only counts as a disconnect
   * when nothing of theirs is still open.
   */
  private async noteSocketGone(ws: WebSocket): Promise<void> {
    await this.load();

    const identity = ws.deserializeAttachment() as SocketIdentity | null;
    if (!identity || !this.session) {
      return;
    }

    const stillOpen = this.ctx
      .getWebSockets(identity.seat)
      .filter((socket) => socket !== ws && socket.readyState === WebSocket.READY_STATE_OPEN);

    if (stillOpen.length > 0) {
      return;
    }

    const dropped = noteDisconnected(this.session, identity.seat, Date.now());
    if (!dropped.changed) {
      return;
    }

    this.session = dropped.session;
    await this.persist();
    this.broadcast(dropped.events);
    await this.armAlarm();
  }

  /**
   * A deadline came due (spec §4).
   *
   * Everything about *which* deadline and *what it means* is the session's; this only
   * supplies the time, routes what comes back and books the next wake-up. One action
   * per wake is enough because each one either ends the game or sets a fresh deadline.
   */
  override async alarm(): Promise<void> {
    await this.load();

    const session = this.session;
    if (!session) {
      return;
    }

    const advanced = advanceClock(session, Date.now(), { seed: autoPlaceSeed() });

    if (advanced.changed) {
      this.session = advanced.session;
      await this.persist();
      this.broadcast(advanced.events);
      await this.reportResultIfFinished();
      await this.armAlarm();
      return;
    }

    // Nothing was due — but this wake-up may *be* the retry of a result that never
    // reached the app. Attempting it unconditionally is what makes that retry real;
    // it no-ops for a game that is unfinished or already reported.
    await this.reportResultIfFinished();

    /**
     * Re-arm only for a wake-up that is genuinely ahead: booking one for an instant
     * that has already passed and produced no action would make this object wake
     * itself in a tight loop, which on the free plan is the one failure mode worth
     * engineering against.
     */
    const at = nextWakeAt(session);
    if (at !== null && at > Date.now()) {
      await this.ctx.storage.setAlarm(at);
      return;
    }

    await this.armAlarm();
  }

  /** Books the next wake-up, or cancels it when there is nothing left to wait for. */
  private async armAlarm(): Promise<void> {
    const at = this.session ? nextWakeAt(this.session) : null;

    if (at === null) {
      /**
       * A finished game has no deadlines left, but it may still owe the Next app its
       * result. Before Block 9 the player who ended the game was always connected, so
       * the next message retried a failed report; a game can now end with both players
       * gone, and then nothing would ever wake this room again. So the retry books its
       * own wake-up, a bounded number of times.
       */
      if (this.shouldRetryReport()) {
        await this.ctx.storage.setAlarm(Date.now() + RESULT_RETRY_MS);
        return;
      }

      await this.ctx.storage.deleteAlarm();
      return;
    }

    // Never in the past: a deadline that has already passed should fire immediately.
    await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 1));
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
      reported: room.reported,
      reportAttempts: room.reportAttempts ?? 0,
      rating: room.rating,
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
      // Creating the session starts spec §4's placement clock.
      this.session = startSession(gameId, { a: seats.a, b: seats.b }, Date.now());
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

    // The placement clock starts with the session, so the wake-up has to be booked
    // here too — otherwise two players who both sit still would wait out a deadline
    // that never fires, because nothing else would wake this object.
    await this.armAlarm();

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

  /**
   * Tells the Next app the match is over, exactly once (spec §5.1).
   *
   * The realtime layer holds no database credentials on purpose, so it signs the
   * authoritative final state and the Next app does the writing and the rating. The
   * `reported` flag is persisted *after* a successful acknowledgement, so a failed or
   * dropped report is retried the next time this room wakes rather than being lost —
   * and the receiving end is idempotent, so a duplicate is harmless either way.
   */
  /** Whether a finished game still owes a report, and is allowed another attempt. */
  private shouldRetryReport(): boolean {
    const room = this.room;
    return (
      this.env.GAME_RESULT_URL !== undefined &&
      room !== null &&
      !room.reported &&
      (room.reportAttempts ?? 0) < MAX_RESULT_ATTEMPTS &&
      this.session?.state.phase === 'finished'
    );
  }

  private async reportResultIfFinished(): Promise<void> {
    const room = this.room;
    const session = this.session;

    if (!room || !session || room.reported || session.state.phase !== 'finished') {
      return;
    }

    const endpoint = this.env.GAME_RESULT_URL;
    if (!endpoint) {
      // Nothing to report to. The flag stays false so a later wake tries again.
      return;
    }

    try {
      const { body, signature } = await signResultReport(
        { gameId: room.gameId, state: encodeGameState(session.state) },
        this.env.GAME_TICKET_SECRET ?? '',
      );

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [RESULT_SIGNATURE_HEADER]: signature },
        body,
      });

      if (!response.ok) {
        await this.recordFailedReport();
        return;
      }

      // The app answers with what the match did to each player's rating; the
      // players are told as soon as it lands (spec §7.6).
      const rating = await this.readRatingReport(response);

      this.room = { ...room, reported: true, reportAttempts: 0, ...(rating ? { rating } : {}) };
      await this.persist();

      if (rating) {
        this.announceRating(rating);
      }
    } catch {
      // Left unreported on purpose; `armAlarm` books the retry.
      await this.recordFailedReport();
    }
  }

  private async recordFailedReport(): Promise<void> {
    const room = this.room;
    if (!room) {
      return;
    }
    this.room = { ...room, reportAttempts: (room.reportAttempts ?? 0) + 1 };
    await this.persist();
  }

  /** Pulls the rating report out of the app's response, tolerating anything else. */
  private async readRatingReport(response: Response): Promise<PersistedRating | undefined> {
    try {
      const body = (await response.json()) as { report?: PersistedRating };
      return body.report && typeof body.report.rated === 'boolean' ? body.report : undefined;
    } catch {
      // A result that was accepted but answered oddly still counts as reported;
      // the rating simply has nothing to show.
      return undefined;
    }
  }

  /** Tells each seat about its own rating change, and only its own. */
  private announceRating(rating: PersistedRating): void {
    for (const seat of ['a', 'b'] as const) {
      for (const socket of this.ctx.getWebSockets(seat)) {
        this.sendTo(socket, ratingEvent(rating, seat));
      }
    }
  }

  private sendRatingTo(ws: WebSocket, seat: PlayerSlot): void {
    const rating = this.room?.rating;
    if (rating) {
      this.sendTo(ws, ratingEvent(rating, seat));
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
