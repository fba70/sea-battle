import type { GameState } from '@/game/state';
import type { PlayerSlot } from '@/game/types';

/**
 * The match clock (spec §4, "Timers & abandonment").
 *
 * Pure and clock-free in the same sense as the rest of the session: it never reads
 * the time, it is *told* the time. Every function takes `now` as an epoch
 * millisecond, so a whole match — including its timeouts — replays identically.
 *
 * The transport owns the wake-ups. This module only answers two questions: when does
 * something next need to happen (`wakeAt`), and what should happen now (`dueAction`).
 */

/** Spec §4's default, and the agreed value: 30 seconds per move. */
export const MOVE_TIMEOUT_MS = 30_000;

/** Spec §4's default: 60 seconds to place a fleet, then it is placed for you. */
export const PLACEMENT_TIMEOUT_MS = 60_000;

/** Spec §4: 30 seconds to come back before the game is decided without you. */
export const DISCONNECT_GRACE_MS = 30_000;

/**
 * Agreed: a player who lets three turns expire loses on time.
 *
 * Counted cumulatively over the whole game, not consecutively. Spec §4 says
 * "consecutive", but the agreed product rule is "after 3 missed turns by the same
 * player" — and cumulative is the stricter reading, so a player cannot stall
 * indefinitely by firing one shot between every pair of lapses.
 */
export const MAX_MISSED_TURNS = 3;

export interface SessionClock {
  /**
   * When the current move or placement deadline falls, or null when no deadline is
   * running — before the clock starts, while it is paused, and once the game ends.
   */
  readonly deadline: number | null;
  /** What was left on the clock when it was paused; null while it is running. */
  readonly remainingMs: number | null;
  /** How many turns each seat has let expire. */
  readonly missedTurns: Readonly<Record<PlayerSlot, number>>;
  /** When each seat went offline, or null while they are connected. */
  readonly offlineSince: Readonly<Record<PlayerSlot, number | null>>;
}

export const IDLE_CLOCK: SessionClock = {
  deadline: null,
  remainingMs: null,
  missedTurns: { a: 0, b: 0 },
  offlineSince: { a: null, b: null },
};

const SEATS: readonly PlayerSlot[] = ['a', 'b'];

/** How long the current phase gets. Finished games get no clock at all. */
export function durationFor(state: GameState): number | null {
  if (state.phase === 'placement') {
    return PLACEMENT_TIMEOUT_MS;
  }
  return state.phase === 'playing' ? MOVE_TIMEOUT_MS : null;
}

/** Seats that are currently disconnected. */
function offlineSeats(clock: SessionClock): readonly PlayerSlot[] {
  return SEATS.filter((seat) => clock.offlineSince[seat] !== null);
}

function graceDeadline(clock: SessionClock, seat: PlayerSlot): number | null {
  const since = clock.offlineSince[seat];
  return since === null ? null : since + DISCONNECT_GRACE_MS;
}

/** True while anyone is away, which is exactly when the move clock must not run. */
export function isPaused(clock: SessionClock): boolean {
  return offlineSeats(clock).length > 0;
}

/**
 * Starts or restarts the deadline for the state the game is now in.
 *
 * Called after every accepted move. While someone is away the clock stays paused and
 * the fresh allowance is banked instead, so nobody burns time they could not use.
 */
export function restart(clock: SessionClock, state: GameState, now: number): SessionClock {
  const duration = durationFor(state);

  if (duration === null) {
    return { ...clock, deadline: null, remainingMs: null };
  }
  if (isPaused(clock)) {
    return { ...clock, deadline: null, remainingMs: duration };
  }
  return { ...clock, deadline: now + duration, remainingMs: null };
}

/** Stops the clock for good; used when the game ends. */
export function stop(clock: SessionClock): SessionClock {
  return { ...clock, deadline: null, remainingMs: null };
}

/**
 * Records a seat going offline and banks whatever time was left.
 *
 * Pausing is the agreed rule and the fair one: without it you could lose on time
 * while waiting for somebody who has already gone.
 */
export function markOffline(clock: SessionClock, seat: PlayerSlot, now: number): SessionClock {
  if (clock.offlineSince[seat] !== null) {
    return clock;
  }

  const paused = isPaused(clock);
  return {
    ...clock,
    offlineSince: { ...clock.offlineSince, [seat]: now },
    // Only the first player to drop freezes the clock; the second finds it frozen.
    deadline: null,
    remainingMs: paused
      ? clock.remainingMs
      : clock.deadline === null
        ? clock.remainingMs
        : Math.max(0, clock.deadline - now),
  };
}

/**
 * Records a seat coming back. The clock resumes only once *everyone* is back, with
 * the time that was left on it.
 */
export function markOnline(clock: SessionClock, seat: PlayerSlot, now: number): SessionClock {
  const next: SessionClock = { ...clock, offlineSince: { ...clock.offlineSince, [seat]: null } };

  if (isPaused(next) || next.remainingMs === null) {
    return next;
  }
  return { ...next, deadline: now + next.remainingMs, remainingMs: null };
}

export function countMissedTurn(clock: SessionClock, seat: PlayerSlot): SessionClock {
  return {
    ...clock,
    missedTurns: { ...clock.missedTurns, [seat]: clock.missedTurns[seat] + 1 },
  };
}

export type ClockAction =
  | { readonly type: 'none' }
  /** The placement deadline passed; fill in whatever fleets are missing. */
  | { readonly type: 'auto_place' }
  /** The move deadline passed for this seat. */
  | { readonly type: 'turn_expired'; readonly seat: PlayerSlot }
  /** This seat has been gone longer than the grace window. */
  | { readonly type: 'disconnect_loss'; readonly seat: PlayerSlot }
  /** Both players are gone and both graces have run out — nobody wins. */
  | { readonly type: 'abandoned' };

/**
 * What, if anything, is due at `now`.
 *
 * Order is deliberate and is where the agreed edge cases live:
 *
 * 1. **Both players away** outranks everything. If both graces have run out the game
 *    ends with no winner — awarding it to whoever's socket happened to survive a
 *    moment longer would be arbitrary, and in a rated game it would pay someone for
 *    walking away. While only one of the two graces has run out we wait, because the
 *    other player may still come back and legitimately claim the win.
 * 2. **One player away past grace** loses, as spec §4 says.
 * 3. **Deadlines** are considered only when both players are present, which follows
 *    from the clock being paused while anyone is away.
 */
export function dueAction(clock: SessionClock, state: GameState, now: number): ClockAction {
  if (state.phase === 'finished') {
    return { type: 'none' };
  }

  const away = offlineSeats(clock);

  if (away.length === 2) {
    const bothExpired = away.every((seat) => now >= (graceDeadline(clock, seat) as number));
    return bothExpired ? { type: 'abandoned' } : { type: 'none' };
  }

  const alone = away[0];
  if (alone !== undefined) {
    return now >= (graceDeadline(clock, alone) as number)
      ? { type: 'disconnect_loss', seat: alone }
      : { type: 'none' };
  }

  if (clock.deadline === null || now < clock.deadline) {
    return { type: 'none' };
  }

  if (state.phase === 'placement') {
    return { type: 'auto_place' };
  }
  return state.turn === null ? { type: 'none' } : { type: 'turn_expired', seat: state.turn };
}

/**
 * When the transport should next wake up, or null if there is nothing to wait for.
 *
 * Mirrors `dueAction`: with both players away the wake-up is the *later* of the two
 * graces, because that is the first moment the no-winner rule can apply.
 */
export function wakeAt(clock: SessionClock, state: GameState): number | null {
  if (state.phase === 'finished') {
    return null;
  }

  const away = offlineSeats(clock);
  if (away.length > 0) {
    const deadlines = away.map((seat) => graceDeadline(clock, seat) as number);
    return away.length === 2 ? Math.max(...deadlines) : (deadlines[0] as number);
  }

  return clock.deadline;
}

/** Whether this seat has now missed one turn too many. */
export function hasTimedOut(clock: SessionClock, seat: PlayerSlot): boolean {
  return clock.missedTurns[seat] >= MAX_MISSED_TURNS;
}
