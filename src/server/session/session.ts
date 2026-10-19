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
 * - **It reads no clock.** Block 9 added deadlines, but the session is still never
 *   allowed to ask what time it is: every entry point takes `now` as an argument, so
 *   a whole match — timeouts and disconnects included — replays identically.
 *
 * SECURITY: `session.state` holds both fleets and must never be serialised to a client.
 * Everything crossing the boundary is built by `eventsFor`/`snapshotFor`, which derive
 * each recipient's payload independently through `createPlayerView(state, seat)`.
 */
import { abandon, concede, skipTurn } from '@/game/abandon';
import { autoPlaceFleet } from '@/game/autoplace';
import { fire } from '@/game/fire';
import { createRng } from '@/game/rng';
import { createGame, hasPlacedFleet, opponentOf, placeFleet, type GameState } from '@/game/state';
import type { FireEvent } from '@/game/fire';
import type { PlayerSlot } from '@/game/types';
import { createPlayerView } from '@/game/view';

import {
  countMissedTurn,
  dueAction,
  hasTimedOut,
  isPaused,
  markOffline,
  markOnline,
  restart,
  stop,
  wakeAt,
  DISCONNECT_GRACE_MS,
  IDLE_CLOCK,
  MAX_MISSED_TURNS,
  type SessionClock,
} from './clock';
import { REACTION_BURST, REACTION_REFILL_MS, type Reaction } from './reactions';
import {
  parseClientMessage,
  type ClientIntent,
  type ServerEvent,
  type SessionError,
  type SessionErrorCode,
  type SnapshotTimers,
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

/**
 * One seat's reaction budget (spec §10: the server owns spam prevention).
 *
 * A token bucket, carried in the session so it survives the transport restarting
 * and so the rule is testable without one. Like everything else here it is told the
 * time rather than reading it.
 */
export interface ReactionBudget {
  readonly tokens: number;
  readonly refilledAt: number;
}

const FULL_BUDGET: ReactionBudget = { tokens: REACTION_BURST, refilledAt: 0 };

/** Refills by elapsed time, capped at the burst size. */
function refill(budget: ReactionBudget, now: number): ReactionBudget {
  if (budget.refilledAt === 0) {
    return { tokens: REACTION_BURST, refilledAt: now };
  }

  const earned = Math.max(0, now - budget.refilledAt) / REACTION_REFILL_MS;
  return {
    tokens: Math.min(REACTION_BURST, budget.tokens + earned),
    refilledAt: now,
  };
}

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
  /** Deadlines, missed turns and who is away (spec §4). Never read from a real clock. */
  readonly clock: SessionClock;
  /** Per-seat reaction allowance (spec §7.4, §10). */
  readonly reactions: Readonly<Record<PlayerSlot, ReactionBudget>>;
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
  /**
   * Starts the placement clock. Omit it and the session has no deadlines at all,
   * which is what a test or a replay wants.
   */
  now?: number;
}): GameSession {
  if (options.seats.a === options.seats.b) {
    throw new Error('A game session needs two distinct players');
  }
  if (options.gameId.length === 0) {
    throw new Error('A game session needs a game id');
  }

  const state = createGame(options.firstTurn === undefined ? {} : { firstTurn: options.firstTurn });

  return {
    gameId: options.gameId,
    state,
    seats: options.seats,
    revision: 0,
    clients: { a: FRESH_CLIENT, b: FRESH_CLIENT },
    clock: options.now === undefined ? IDLE_CLOCK : restart(IDLE_CLOCK, state, options.now),
    reactions: { a: FULL_BUDGET, b: FULL_BUDGET },
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
  /** The clock as it was persisted; a missing one simply has no deadlines running. */
  clock?: SessionClock;
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
    clock: options.clock ?? IDLE_CLOCK,
    // A resumed session starts with a full allowance: the budget is spam control,
    // not a score to carry across a reconnect.
    reactions: { a: FULL_BUDGET, b: FULL_BUDGET },
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
  return snapshotOf(session.state, seat, session.revision, session.clock);
}

/**
 * The clock as one recipient may see it.
 *
 * Filtered per seat like the board is: you are told whether *your opponent* is away
 * and how long they have left, never anything about their fleet. Nothing here is
 * secret, but it is built per recipient so the rule has no exceptions.
 */
function timersFor(clock: SessionClock, seat: PlayerSlot): SnapshotTimers {
  const other = opponentOf(seat);
  const offlineSince = clock.offlineSince[other];

  return {
    deadlineTs: clock.deadline,
    paused: isPaused(clock),
    opponentOffline: offlineSince !== null,
    opponentGraceDeadlineTs: offlineSince === null ? null : offlineSince + DISCONNECT_GRACE_MS,
    missedTurns: clock.missedTurns,
    maxMissedTurns: MAX_MISSED_TURNS,
  };
}

/** The events addressed to one seat. Adapters MUST route by seat, never broadcast. */
export function eventsFor(outcome: SessionOutcome, seat: PlayerSlot): readonly ServerEvent[] {
  return outcome.events[seat];
}

// ---------------------------------------------------------------------------
// Internal builders
// ---------------------------------------------------------------------------

function snapshotOf(
  state: GameState,
  seat: PlayerSlot,
  revision: number,
  clock: SessionClock,
): StateSnapshotEvent {
  return {
    type: 'state_snapshot',
    view: createPlayerView(state, seat),
    revision,
    timers: timersFor(clock, seat),
  };
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
  nextClock: SessionClock,
): SessionOutcome {
  const changed = nextState !== session.state;

  const next: GameSession = {
    ...session,
    state: nextState,
    revision: changed ? session.revision + 1 : session.revision,
    clients: { ...session.clients, [seat]: { lastAcceptedSeq: seq, lastEvents: events } },
    clock: nextClock,
  };

  return { status: 'accepted', session: next, error: null, events };
}

/**
 * The clock a move leaves behind.
 *
 * A finished game stops the clock; anything else gets a fresh allowance. Callers
 * that pass no `now` — tests, replays — leave the clock untouched, which keeps every
 * timer-free call site behaving exactly as it did before Block 9.
 */
function clockAfterMove(
  session: GameSession,
  nextState: GameState,
  now: number | undefined,
): SessionClock {
  if (now === undefined) {
    return session.clock;
  }
  return nextState.phase === 'finished'
    ? stop(session.clock)
    : restart(session.clock, nextState, now);
}

/** The deadline to advertise on a `turn_changed`, when one is running. */
function deadlineField(clock: SessionClock): { deadlineTs?: number } {
  return clock.deadline === null ? {} : { deadlineTs: clock.deadline };
}

/**
 * Events for an accepted shot, built once per recipient.
 *
 * `fire_result` and `ship_sunk` carry only facts both players legitimately know — the
 * cell fired at, its outcome, and the outline of a ship that has already sunk (spec §4).
 * Everything board-shaped comes from the per-seat snapshot.
 */
function fireEvents(
  next: GameState,
  firedBy: PlayerSlot,
  event: FireEvent,
  revision: number,
  clock: SessionClock,
) {
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
      events.push({ type: 'turn_changed', activePlayer: next.turn, ...deadlineField(clock) });
    }

    events.push(snapshotOf(next, seat, revision, clock));
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
  now: number | undefined,
): SessionOutcome {
  // `placeFleet` runs `validateFleet` itself: composition, bounds, overlap and the
  // no-touching rule (spec §4), plus the phase and already-placed checks.
  const placed = placeFleet(session.state, seat, intent.placements);

  if (!placed.ok) {
    return reject(session, seat, placed.error.code, placed.error.message, 'placement_rejected');
  }

  const next = placed.value;
  const revision = session.revision + 1;
  // Both fleets in means the move clock starts; one fleet in leaves the placement
  // deadline exactly where it was, so a quick placer does not extend it for the other.
  const clock = next.phase === 'playing' ? clockAfterMove(session, next, now) : session.clock;

  const events = forEachSeat<readonly ServerEvent[]>((recipient) => {
    const list: ServerEvent[] = [];
    if (recipient === seat) {
      list.push({ type: 'placement_accepted' });
    }
    if (next.phase === 'playing' && next.turn !== null) {
      list.push({ type: 'turn_changed', activePlayer: next.turn, ...deadlineField(clock) });
    }
    list.push(snapshotOf(next, recipient, revision, clock));
    return list;
  });

  return accept(session, seat, seq, next, events, clock);
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
      ? [
          { type: 'placement_accepted' },
          snapshotOf(session.state, recipient, session.revision, session.clock),
        ]
      : [],
  );

  return accept(session, seat, seq, session.state, events, session.clock);
}

function handleFire(
  session: GameSession,
  seat: PlayerSlot,
  seq: number,
  intent: Extract<ClientIntent, { type: 'fire' }>,
  now: number | undefined,
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
  const clock = clockAfterMove(session, next, now);

  return accept(
    session,
    seat,
    seq,
    next,
    fireEvents(next, seat, result.value.event, revision, clock),
    clock,
  );
}

/**
 * Resignation (spec §4: "rage-quit / explicit leave = immediate forfeit").
 *
 * No confirmation step here on purpose — asking "are you sure?" is the client's job,
 * and a server that waited for a second message would just be a worse protocol. By
 * the time this arrives the player has decided.
 */
function handleResign(session: GameSession, seat: PlayerSlot, seq: number): SessionOutcome {
  const conceded = concede(session.state, seat, 'forfeit');
  if (!conceded.ok) {
    return reject(session, seat, 'wrong_phase', conceded.error.message);
  }

  const next = conceded.value;
  const revision = session.revision + 1;
  const clock = stop(session.clock);

  return accept(session, seat, seq, next, endEvents(next, revision, clock), clock);
}

/**
 * Relays a reaction to both players (spec §7.4).
 *
 * Deliberately not a move: no board changes, the revision does not advance, and the
 * move clock is untouched — reacting must never buy a player time.
 *
 * Rate limiting is here rather than in the client because a client cannot be asked
 * to restrain itself (spec §10). A refused reaction is an honest rejection; the UI
 * chooses to stay quiet about it.
 */
function handleReact(
  session: GameSession,
  seat: PlayerSlot,
  seq: number,
  emoji: Reaction,
  now: number | undefined,
): SessionOutcome {
  if (session.state.phase === 'finished') {
    return reject(session, seat, 'wrong_phase', 'The match is over');
  }

  // With no clock to measure against, every reaction is allowed; only a test runs
  // that way, and it is testing something else.
  const budget = now === undefined ? null : refill(session.reactions[seat], now);

  if (budget !== null && budget.tokens < 1) {
    return reject(session, seat, 'rate_limited', 'Too many reactions, too quickly');
  }

  const events = forEachSeat<readonly ServerEvent[]>(() => [
    { type: 'reaction', from: seat, emoji },
  ]);

  const next: GameSession = {
    ...session,
    clients: { ...session.clients, [seat]: { lastAcceptedSeq: seq, lastEvents: events } },
    ...(budget === null
      ? {}
      : {
          reactions: {
            ...session.reactions,
            [seat]: { tokens: budget.tokens - 1, refilledAt: budget.refilledAt },
          },
        }),
  };

  return { status: 'accepted', session: next, error: null, events };
}

/** `game_over` plus a fresh snapshot, for every way a game can end outside `fire`. */
function endEvents(next: GameState, revision: number, clock: SessionClock): SessionEvents {
  return forEachSeat<readonly ServerEvent[]>((seat) => [
    // `concede` and `abandon` always set a reason; the guard satisfies the types.
    ...(next.resultReason === null
      ? []
      : [
          {
            type: 'game_over' as const,
            winner: next.winner,
            reason: next.resultReason,
          },
        ]),
    snapshotOf(next, seat, revision, clock),
  ]);
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
  /**
   * The server's current time, used only to restart deadlines. Omitting it leaves
   * the clock untouched, which is what a timer-free test or a replay wants.
   */
  now?: number,
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
      return handlePlaceFleet(session, seat, seq, intent, now);
    case 'ready':
      return handleReady(session, seat, seq);
    case 'fire':
      return handleFire(session, seat, seq, intent, now);
    case 'resign':
      return handleResign(session, seat, seq);
    case 'react':
      return handleReact(session, seat, seq, intent.emoji, now);
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

// ---------------------------------------------------------------------------
// Connection lifecycle and the clock (spec §4)
// ---------------------------------------------------------------------------

/** The result of a clock event: a session, what to send, and whether anything moved. */
export interface ClockOutcome {
  readonly session: GameSession;
  readonly events: SessionEvents;
  readonly changed: boolean;
}

const UNCHANGED = (session: GameSession): ClockOutcome => ({
  session,
  events: NO_EVENTS,
  changed: false,
});

/**
 * A seat's connection dropped.
 *
 * The clock freezes for *both* players — you should never lose on time waiting for
 * someone who has already gone — and the opponent is told when the grace window
 * closes so their UI can count it down.
 */
export function noteDisconnected(
  session: GameSession,
  seat: PlayerSlot,
  now: number,
): ClockOutcome {
  if (session.state.phase === 'finished' || session.clock.offlineSince[seat] !== null) {
    return UNCHANGED(session);
  }

  const next: GameSession = { ...session, clock: markOffline(session.clock, seat, now) };
  const other = opponentOf(seat);

  return {
    session: next,
    events: {
      ...NO_EVENTS,
      [other]: [
        {
          type: 'opponent_disconnected',
          seat,
          graceDeadlineTs: now + DISCONNECT_GRACE_MS,
        },
        snapshotFor(next, other),
      ],
      [seat]: [snapshotFor(next, seat)],
    },
    changed: true,
  };
}

/**
 * A seat came back inside its grace window.
 *
 * The clock only restarts once everybody is back, and it restarts with the time that
 * was left on it rather than a fresh allowance.
 */
export function noteReconnected(session: GameSession, seat: PlayerSlot, now: number): ClockOutcome {
  if (session.clock.offlineSince[seat] === null) {
    return UNCHANGED(session);
  }

  const next: GameSession = { ...session, clock: markOnline(session.clock, seat, now) };
  const other = opponentOf(seat);

  return {
    session: next,
    events: {
      ...NO_EVENTS,
      [other]: [{ type: 'opponent_reconnected', seat }, snapshotFor(next, other)],
      [seat]: [snapshotFor(next, seat)],
    },
    changed: true,
  };
}

/** When the transport should wake this session up next, if ever. */
export function nextWakeAt(session: GameSession): number | null {
  return wakeAt(session.clock, session.state);
}

/** Fills in any fleet still missing when the placement deadline passes (spec §4). */
function autoPlaceMissing(state: GameState, seed: number): GameState {
  let next = state;

  for (const [index, seat] of SEATS.entries()) {
    if (hasPlacedFleet(next.boards[seat])) {
      continue;
    }
    // Seeded rather than self-randomising, so this function stays pure and testable.
    // The caller must supply an *unpredictable* seed: both players know the game id,
    // so anything derived from it would let an opponent reproduce this fleet.
    const placed = placeFleet(next, seat, autoPlaceFleet(createRng(seed + index)));
    if (placed.ok) {
      next = placed.value;
    }
  }

  return next;
}

/**
 * Applies whatever the clock says is due at `now` (spec §4).
 *
 * One action per call, because every action either ends the game or sets a deadline
 * in the future. The transport re-arms from `nextWakeAt` and calls again if needed.
 *
 * The ordering that decides the hard cases lives in `dueAction`; this function only
 * carries each decision out.
 */
export function advanceClock(
  session: GameSession,
  now: number,
  options: { readonly seed?: number } = {},
): ClockOutcome {
  const action = dueAction(session.clock, session.state, now);

  switch (action.type) {
    case 'none':
      return UNCHANGED(session);

    case 'abandoned': {
      // Both players gone, both graces expired: nobody is awarded anything.
      const ended = abandon(session.state, 'disconnect');
      if (!ended.ok) {
        return UNCHANGED(session);
      }
      return endOutcome(session, ended.value);
    }

    case 'disconnect_loss': {
      const ended = concede(session.state, action.seat, 'disconnect');
      if (!ended.ok) {
        return UNCHANGED(session);
      }
      return endOutcome(session, ended.value);
    }

    case 'auto_place': {
      const placed = autoPlaceMissing(session.state, options.seed ?? now);
      const clock = restart(session.clock, placed, now);
      const next: GameSession = {
        ...session,
        state: placed,
        revision: session.revision + 1,
        clock,
      };

      return {
        session: next,
        events: forEachSeat<readonly ServerEvent[]>((seat) => [
          ...(placed.phase === 'playing' && placed.turn !== null
            ? [
                {
                  type: 'turn_changed' as const,
                  activePlayer: placed.turn,
                  ...deadlineField(clock),
                },
              ]
            : []),
          snapshotFor(next, seat),
        ]),
        changed: true,
      };
    }

    case 'turn_expired': {
      const counted = countMissedTurn(session.clock, action.seat);

      // Third strike: the game is over on time (spec §4's "auto-forfeit after K
      // consecutive expiries", with K agreed as three).
      if (hasTimedOut(counted, action.seat)) {
        const ended = concede(session.state, action.seat, 'timeout');
        if (!ended.ok) {
          return UNCHANGED(session);
        }
        return endOutcome({ ...session, clock: counted }, ended.value);
      }

      const skipped = skipTurn(session.state, action.seat);
      if (!skipped.ok) {
        return UNCHANGED(session);
      }

      const clock = restart(counted, skipped.value, now);
      const next: GameSession = {
        ...session,
        state: skipped.value,
        revision: session.revision + 1,
        clock,
      };

      return {
        session: next,
        events: forEachSeat<readonly ServerEvent[]>((seat) => [
          {
            type: 'turn_skipped',
            seat: action.seat,
            missedTurns: counted.missedTurns[action.seat],
          },
          ...(skipped.value.turn === null
            ? []
            : [
                {
                  type: 'turn_changed' as const,
                  activePlayer: skipped.value.turn,
                  ...deadlineField(clock),
                },
              ]),
          snapshotFor(next, seat),
        ]),
        changed: true,
      };
    }
  }
}

/** Shared tail for every clock action that ends the game. */
function endOutcome(session: GameSession, ended: GameState): ClockOutcome {
  const clock = stop(session.clock);
  const next: GameSession = {
    ...session,
    state: ended,
    revision: session.revision + 1,
    clock,
  };

  return { session: next, events: endEvents(ended, next.revision, clock), changed: true };
}

/** Every seat in the game, for callers that need to iterate recipients. */
export const PLAYER_SEATS = SEATS;
