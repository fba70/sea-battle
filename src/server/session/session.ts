/**
 * The authoritative game session: a transport-independent referee (spec §5.1, §5.3).
 *
 * A `GameSession` owns the full `GameState` — both fleets — accepts §9 intents from an
 * identified player, applies them with the existing rules engine, and produces
 * **per-recipient** §9 events. It is the Block 1 half of the multiplayer layer: whatever
 * OQ-2 settles on (Durable Objects, PartyKit, Redis + Ably) becomes a thin adapter
 * *around* this, not a dependency *inside* it.
 *
 * What this layer does NOT do, on purpose:
 *
 * - **It does not re-implement any Battleship rule.** Placement legality, phases, turn
 *   ownership, duplicate and known-empty shots, sinking and win detection are all
 *   `src/game`'s, and its error codes are reused verbatim rather than remapped.
 * - **It knows nothing about transport.** No sockets, no HTTP, no Redis, no database,
 *   no React. An ESLint rule in eslint.config.mjs enforces that.
 * - **It owns no timers and no clock.** Every transition is a pure function of
 *   (session, playerId, message), so a session replays identically. Timers are Block 9.
 *
 * SECURITY: `session.state` holds both fleets and must never be serialised to a client.
 * Everything crossing the boundary is built by `eventsFor`/`snapshotFor`, which derive
 * each recipient's payload independently through `createPlayerView(state, seat)`.
 */
import { fire } from '@/game/fire';
import { createGame, hasPlacedFleet, opponentOf, placeFleet, type GameState } from '@/game/state';
import type { FireEvent } from '@/game/fire';
import type { PlayerSlot } from '@/game/types';
import { createPlayerView } from '@/game/view';

import {
  parseClientMessage,
  type ClientIntent,
  type ServerEvent,
  type SessionError,
  type SessionErrorCode,
  type StateSnapshotEvent,
} from './protocol';

/** Which player id holds which seat. Ids are opaque to the session. */
export interface SessionSeats {
  readonly a: string;
  readonly b: string;
}

/**
 * Per-player replay protection (spec §10).
 *
 * `lastAcceptedSeq` advances only when an intent is *accepted*; a rejection leaves it
 * alone, so a client that retries after an error is not then told its retry is stale.
 * `lastEvents` caches what that accepted intent produced, so an honest retry after a
 * dropped response gets the same answer instead of re-applying the move.
 */
export interface ClientSequencing {
  /** -1 until this player has had an intent accepted. */
  readonly lastAcceptedSeq: number;
  readonly lastEvents: SessionEvents | null;
}

/** Events addressed by seat. Each seat's list is derived independently. */
export type SessionEvents = Readonly<Record<PlayerSlot, readonly ServerEvent[]>>;

export interface GameSession {
  readonly gameId: string;
  /** Authoritative, both fleets. Never send this anywhere. */
  readonly state: GameState;
  readonly seats: SessionSeats;
  /**
   * Monotonic server-side revision, incremented whenever `state` changes. A future
   * transport can use it to spot a gap and re-send a snapshot instead of an increment.
   */
  readonly revision: number;
  readonly clients: Readonly<Record<PlayerSlot, ClientSequencing>>;
}

export type SessionStatus = 'accepted' | 'rejected' | 'replayed';

export interface SessionOutcome {
  readonly status: SessionStatus;
  /** The next session. On a rejection or a replay this is the *same object*. */
  readonly session: GameSession;
  /** Set on `rejected`, including when the sender holds no seat. */
  readonly error: SessionError | null;
  readonly events: SessionEvents;
}

const NO_EVENTS: SessionEvents = { a: [], b: [] };

const FRESH_CLIENT: ClientSequencing = { lastAcceptedSeq: -1, lastEvents: null };

const SEATS: readonly PlayerSlot[] = ['a', 'b'];

/** Builds a value for both seats, calling `build` once per seat. */
function forEachSeat<T>(build: (seat: PlayerSlot) => T): Readonly<Record<PlayerSlot, T>> {
  return { a: build('a'), b: build('b') };
}

export function createSession(options: {
  gameId: string;
  seats: SessionSeats;
  firstTurn?: PlayerSlot;
}): GameSession {
  if (options.seats.a === options.seats.b) {
    throw new Error('A game session needs two distinct players');
  }
  if (options.gameId.length === 0) {
    throw new Error('A game session needs a game id');
  }

  return {
    gameId: options.gameId,
    state: createGame(options.firstTurn === undefined ? {} : { firstTurn: options.firstTurn }),
    seats: options.seats,
    revision: 0,
    clients: { a: FRESH_CLIENT, b: FRESH_CLIENT },
  };
}

/**
 * Rebuilds a session around an existing authoritative state — the consumer of
 * `decodeGameState()`. Sequencing starts fresh: a resumed connection is a new
 * connection, and its `seq` counter restarts with it.
 */
export function resumeSession(options: {
  gameId: string;
  seats: SessionSeats;
  state: GameState;
  revision?: number;
}): GameSession {
  if (options.seats.a === options.seats.b) {
    throw new Error('A game session needs two distinct players');
  }

  return {
    gameId: options.gameId,
    state: options.state,
    seats: options.seats,
    revision: options.revision ?? 0,
    clients: { a: FRESH_CLIENT, b: FRESH_CLIENT },
  };
}

/**
 * Restores per-player replay protection after the session was rebuilt from storage.
 *
 * `resumeSession` deliberately starts sequencing fresh, which is right when a *client*
 * reconnects. It is wrong when the *server* restarts underneath a still-connected
 * client — a hibernating Durable Object, say — because a client that had `seq = 5`
 * accepted could then resend it and have it applied a second time (spec §10).
 *
 * `lastEvents` is seeded with each seat's current snapshot rather than the original
 * cached events, which are not worth persisting per move. A replayed intent therefore
 * answers with the authoritative state as it stands, which is at least as correct as
 * the stale response it originally produced, and the important part holds: the intent
 * is not applied again.
 */
export function restoreSequencing(
  session: GameSession,
  lastAcceptedSeq: Readonly<Record<PlayerSlot, number>>,
): GameSession {
  const snapshots: SessionEvents = forEachSeat<readonly ServerEvent[]>((seat) => [
    snapshotFor(session, seat),
  ]);

  return {
    ...session,
    clients: forEachSeat((seat) => ({
      lastAcceptedSeq: lastAcceptedSeq[seat],
      lastEvents: lastAcceptedSeq[seat] >= 0 ? snapshots : null,
    })),
  };
}

/** The seat this player holds, or null if they are not in this game (spec §10). */
export function seatOf(session: GameSession, playerId: string): PlayerSlot | null {
  if (playerId === session.seats.a) {
    return 'a';
  }
  if (playerId === session.seats.b) {
    return 'b';
  }
  return null;
}

/**
 * The only state payload a player may receive.
 *
 * Derived per seat from the authoritative state, so two players never share a payload
 * object and the filter runs once per recipient (spec §5.1, §10).
 */
export function snapshotFor(session: GameSession, seat: PlayerSlot): StateSnapshotEvent {
  return {
    type: 'state_snapshot',
    view: createPlayerView(session.state, seat),
    revision: session.revision,
  };
}

/** The events addressed to one seat. Adapters MUST route by seat, never broadcast. */
export function eventsFor(outcome: SessionOutcome, seat: PlayerSlot): readonly ServerEvent[] {
  return outcome.events[seat];
}

// ---------------------------------------------------------------------------
// Internal builders
// ---------------------------------------------------------------------------

function snapshotOf(state: GameState, seat: PlayerSlot, revision: number): StateSnapshotEvent {
  return { type: 'state_snapshot', view: createPlayerView(state, seat), revision };
}

function reject(
  session: GameSession,
  seat: PlayerSlot | null,
  code: SessionErrorCode,
  message: string,
  as: 'error' | 'placement_rejected' = 'error',
): SessionOutcome {
  const error: SessionError = { code, message };
  const event: ServerEvent =
    as === 'placement_rejected'
      ? { type: 'placement_rejected', reason: code, message }
      : { type: 'error', code, message };

  return {
    status: 'rejected',
    // Identity-equal, so "the authoritative state did not change" is trivially checkable.
    session,
    error,
    events: seat === null ? NO_EVENTS : { ...NO_EVENTS, [seat]: [event] },
  };
}

function accept(
  session: GameSession,
  seat: PlayerSlot,
  seq: number,
  nextState: GameState,
  events: SessionEvents,
): SessionOutcome {
  const changed = nextState !== session.state;

  const next: GameSession = {
    ...session,
    state: nextState,
    revision: changed ? session.revision + 1 : session.revision,
    clients: { ...session.clients, [seat]: { lastAcceptedSeq: seq, lastEvents: events } },
  };

  return { status: 'accepted', session: next, error: null, events };
}

/**
 * Events for an accepted shot, built once per recipient.
 *
 * `fire_result` and `ship_sunk` carry only facts both players legitimately know — the
 * cell fired at, its outcome, and the outline of a ship that has already sunk (spec §4).
 * Everything board-shaped comes from the per-seat snapshot.
 */
function fireEvents(next: GameState, firedBy: PlayerSlot, event: FireEvent, revision: number) {
  return forEachSeat<readonly ServerEvent[]>((seat) => {
    const events: ServerEvent[] = [
      {
        type: 'fire_result',
        firedBy,
        cells: [
          {
            coord: event.coord,
            outcome: event.outcome,
            ...(event.sunk ? { shipOutline: event.sunk.outline } : {}),
          },
        ],
        extraTurn: event.extraTurn,
      },
    ];

    if (event.sunk) {
      events.push({
        type: 'ship_sunk',
        owner: opponentOf(firedBy),
        shipClass: event.sunk.shipClass,
        outline: event.sunk.outline,
        bufferCells: event.sunk.bufferCells,
      });
    }

    if (event.gameOver) {
      // `fire` always sets both when it finishes a game; the guard satisfies the types.
      if (next.resultReason !== null) {
        events.push({ type: 'game_over', winner: next.winner, reason: next.resultReason });
      }
    } else if (next.turn !== null) {
      events.push({ type: 'turn_changed', activePlayer: next.turn });
    }

    events.push(snapshotOf(next, seat, revision));
    return events;
  });
}

// ---------------------------------------------------------------------------
// Intent handlers — each one delegates its rules to src/game
// ---------------------------------------------------------------------------

function handlePlaceFleet(
  session: GameSession,
  seat: PlayerSlot,
  seq: number,
  intent: Extract<ClientIntent, { type: 'place_fleet' }>,
): SessionOutcome {
  // `placeFleet` runs `validateFleet` itself: composition, bounds, overlap and the
  // no-touching rule (spec §4), plus the phase and already-placed checks.
  const placed = placeFleet(session.state, seat, intent.placements);

  if (!placed.ok) {
    return reject(session, seat, placed.error.code, placed.error.message, 'placement_rejected');
  }

  const next = placed.value;
  const revision = session.revision + 1;

  const events = forEachSeat<readonly ServerEvent[]>((recipient) => {
    const list: ServerEvent[] = [];
    if (recipient === seat) {
      list.push({ type: 'placement_accepted' });
    }
    if (next.phase === 'playing' && next.turn !== null) {
      list.push({ type: 'turn_changed', activePlayer: next.turn });
    }
    list.push(snapshotOf(next, recipient, revision));
    return list;
  });

  return accept(session, seat, seq, next, events);
}

/**
 * §9 lists `place_fleet` (proposed) and `ready` (confirm) as separate intents. The
 * engine has no uncommitted-fleet concept: `placeFleet` validates and installs in one
 * step, which is the re-validation §5.3 actually requires. Staging a proposed fleet in
 * the session would put board data outside `GameState` — a second source of truth the
 * codec could not persist.
 *
 * So `ready` is an idempotent confirmation: it succeeds once this seat's fleet is in,
 * and changes no state. If the UI ever needs revise-after-submit, that belongs in the
 * client draft, not in a second server-side board.
 */
function handleReady(session: GameSession, seat: PlayerSlot, seq: number): SessionOutcome {
  if (!hasPlacedFleet(session.state.boards[seat])) {
    return reject(session, seat, 'fleet_not_placed', 'Place a fleet before confirming readiness');
  }

  const events = forEachSeat<readonly ServerEvent[]>((recipient) =>
    recipient === seat
      ? [{ type: 'placement_accepted' }, snapshotOf(session.state, recipient, session.revision)]
      : [],
  );

  return accept(session, seat, seq, session.state, events);
}

function handleFire(
  session: GameSession,
  seat: PlayerSlot,
  seq: number,
  intent: Extract<ClientIntent, { type: 'fire' }>,
): SessionOutcome {
  // Spec §9: "reject fire when ... wrong salvo size". Classic is one cell per turn
  // (§4); the schema only bounds the array, because the legal size is mode- and
  // state-dependent and therefore the session's call, not the schema's.
  const [coord, ...rest] = intent.cells;

  if (coord === undefined || rest.length > 0) {
    return reject(
      session,
      seat,
      'wrong_salvo_size',
      `Classic takes exactly one cell per turn, got ${intent.cells.length}`,
    );
  }

  // Turn ownership, phase, bounds, duplicate and known-empty rejection, sinking,
  // buffer reveal and win detection are all the engine's.
  const result = fire(session.state, seat, coord);

  if (!result.ok) {
    return reject(session, seat, result.error.code, result.error.message);
  }

  const next = result.value.state;
  const revision = session.revision + 1;

  return accept(session, seat, seq, next, fireEvents(next, seat, result.value.event, revision));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Applies one untrusted client message on behalf of `playerId`.
 *
 * The full boundary in order: seat ownership, schema validation, replay/sequencing,
 * then the engine. A rejection at any step leaves `session.state` untouched and returns
 * the *same* session object.
 */
export function applyIntent(
  session: GameSession,
  playerId: string,
  message: unknown,
): SessionOutcome {
  const seat = seatOf(session, playerId);

  if (seat === null) {
    // No seat means no recipient: there is no player to address an event to.
    return reject(session, null, 'not_a_participant', 'You are not a player in this game');
  }

  const parsed = parseClientMessage(message);
  if (!parsed.ok) {
    return reject(session, seat, parsed.error.code, parsed.error.message);
  }

  const { seq, intent } = parsed.message;
  const client = session.clients[seat];

  // Spec §10: a replayed or duplicated message must not apply the action twice.
  if (client.lastEvents !== null && seq === client.lastAcceptedSeq) {
    return { status: 'replayed', session, error: null, events: client.lastEvents };
  }
  if (seq < client.lastAcceptedSeq) {
    return reject(
      session,
      seat,
      'stale_sequence',
      `Sequence ${seq} is behind the last accepted ${client.lastAcceptedSeq}`,
    );
  }

  switch (intent.type) {
    case 'place_fleet':
      return handlePlaceFleet(session, seat, seq, intent);
    case 'ready':
      return handleReady(session, seat, seq);
    case 'fire':
      return handleFire(session, seat, seq, intent);
    case 'react':
    case 'resign':
      // Reactions are Block 11; resign needs a forfeit transition the engine does not
      // have yet and that belongs with abandonment and timers in Block 9.
      return reject(
        session,
        seat,
        'unsupported_intent',
        `The session layer does not handle '${intent.type}' yet`,
      );
    case 'join':
    case 'heartbeat':
      // Connection lifecycle: the transport adapter's job once OQ-2 is settled.
      return reject(
        session,
        seat,
        'unsupported_intent',
        `'${intent.type}' is handled by the transport adapter, not the session`,
      );
  }
}

/** Every seat in the game, for callers that need to iterate recipients. */
export const PLAYER_SEATS = SEATS;
