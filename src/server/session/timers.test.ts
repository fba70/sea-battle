import { describe, expect, it } from 'vitest';

import { DISCONNECT_GRACE_MS, MOVE_TIMEOUT_MS, PLACEMENT_TIMEOUT_MS } from './clock';
import type { ServerEvent, StateSnapshotEvent } from './protocol';
import {
  advanceClock,
  nextWakeAt,
  noteDisconnected,
  noteReconnected,
  snapshotFor,
  type GameSession,
} from './session';
import {
  newTimedSession,
  sendAt,
  startedSession,
  ALWAYS_MISS,
  PLAYER_A,
  PLAYER_B,
  T0,
} from './testing';
import { FLEET_A, FLEET_B } from '@/game/testing/fixtures';

/** A game in progress with a running clock, seat A to move. */
function timedGame(now: number = T0): GameSession {
  let session = newTimedSession(now);
  const a = sendAt(session, PLAYER_A, { type: 'place_fleet', placements: [...FLEET_A] }, 0, now);
  session = a.session;
  const b = sendAt(session, PLAYER_B, { type: 'place_fleet', placements: [...FLEET_B] }, 0, now);
  return b.session;
}

const typesFor = (events: readonly ServerEvent[]) => events.map((event) => event.type);

function timersOf(session: GameSession, seat: 'a' | 'b') {
  return (snapshotFor(session, seat) as StateSnapshotEvent).timers;
}

describe('the clock starts with the game', () => {
  it('gives placement 60 seconds', () => {
    expect(newTimedSession().clock.deadline).toBe(T0 + PLACEMENT_TIMEOUT_MS);
  });

  it('switches to the 30-second move clock once both fleets are in', () => {
    expect(timedGame().clock.deadline).toBe(T0 + MOVE_TIMEOUT_MS);
  });

  it('gives every move a fresh 30 seconds', () => {
    const fired = sendAt(
      timedGame(),
      PLAYER_A,
      { type: 'fire', cells: [ALWAYS_MISS] },
      1,
      T0 + 12_000,
    );
    expect(fired.session.clock.deadline).toBe(T0 + 12_000 + MOVE_TIMEOUT_MS);
  });

  it('leaves a session with no clock exactly as it behaved before', () => {
    // Every pre-Block-9 call site omits `now`; none of them grew a deadline.
    expect(startedSession().clock.deadline).toBeNull();
    expect(nextWakeAt(startedSession())).toBeNull();
  });

  it('tells the player when their turn ends', () => {
    const turnChanged = timedGame().clients.b.lastEvents?.b.find(
      (event) => event.type === 'turn_changed',
    );
    expect(turnChanged).toMatchObject({ deadlineTs: T0 + MOVE_TIMEOUT_MS });
  });
});

describe('resigning', () => {
  it('ends the game immediately and gives the win to the other player', () => {
    const outcome = sendAt(timedGame(), PLAYER_A, { type: 'resign' }, 1, T0 + 5_000);

    expect(outcome.status).toBe('accepted');
    expect(outcome.session.state).toMatchObject({
      phase: 'finished',
      winner: 'b',
      resultReason: 'forfeit',
    });
  });

  it('tells both players, and stops the clock', () => {
    const outcome = sendAt(timedGame(), PLAYER_B, { type: 'resign' }, 1, T0 + 5_000);

    expect(typesFor(outcome.events.a)).toContain('game_over');
    expect(typesFor(outcome.events.b)).toContain('game_over');
    expect(outcome.session.clock.deadline).toBeNull();
    expect(nextWakeAt(outcome.session)).toBeNull();
  });

  it('works during placement too — leaving early is still leaving', () => {
    const outcome = sendAt(newTimedSession(), PLAYER_A, { type: 'resign' }, 0, T0);
    expect(outcome.session.state.winner).toBe('b');
  });

  it('cannot be used twice to overwrite the result', () => {
    const first = sendAt(timedGame(), PLAYER_A, { type: 'resign' }, 1, T0 + 1_000);
    const second = sendAt(first.session, PLAYER_B, { type: 'resign' }, 2, T0 + 2_000);

    expect(second.status).toBe('rejected');
    expect(first.session.state.winner).toBe('b');
  });
});

describe('a player drops', () => {
  it('freezes the clock and warns the opponent with a deadline', () => {
    const dropped = noteDisconnected(timedGame(), 'a', T0 + 10_000);

    expect(dropped.changed).toBe(true);
    expect(dropped.events.b[0]).toEqual({
      type: 'opponent_disconnected',
      seat: 'a',
      graceDeadlineTs: T0 + 10_000 + DISCONNECT_GRACE_MS,
    });
    expect(timersOf(dropped.session, 'b')).toMatchObject({
      paused: true,
      deadlineTs: null,
      opponentOffline: true,
      opponentGraceDeadlineTs: T0 + 10_000 + DISCONNECT_GRACE_MS,
    });
  });

  it('resumes with the time that was left when they come back', () => {
    const dropped = noteDisconnected(timedGame(), 'a', T0 + 10_000);
    const back = noteReconnected(dropped.session, 'a', T0 + 25_000);

    // 20 seconds were left; 20 seconds are left.
    expect(back.session.clock.deadline).toBe(T0 + 25_000 + 20_000);
    expect(back.events.b[0]).toEqual({ type: 'opponent_reconnected', seat: 'a' });
  });

  it('loses the game for them once the grace window closes', () => {
    const dropped = noteDisconnected(timedGame(), 'a', T0);
    const resolved = advanceClock(dropped.session, T0 + DISCONNECT_GRACE_MS);

    expect(resolved.session.state).toMatchObject({
      phase: 'finished',
      winner: 'b',
      resultReason: 'disconnect',
    });
  });

  it('does nothing while they still have time', () => {
    const dropped = noteDisconnected(timedGame(), 'a', T0);
    const early = advanceClock(dropped.session, T0 + DISCONNECT_GRACE_MS - 1);

    expect(early.changed).toBe(false);
    expect(early.session.state.phase).toBe('playing');
  });

  it('is ignored during placement only in the sense that the rules are the same', () => {
    const dropped = noteDisconnected(newTimedSession(), 'b', T0);
    const resolved = advanceClock(dropped.session, T0 + DISCONNECT_GRACE_MS);

    // The agreed rule: grace applies during placement too.
    expect(resolved.session.state).toMatchObject({ phase: 'finished', winner: 'a' });
  });

  it('is not recorded twice for the same seat', () => {
    const once = noteDisconnected(timedGame(), 'a', T0 + 5_000);
    const twice = noteDisconnected(once.session, 'a', T0 + 9_000);

    expect(twice.changed).toBe(false);
    expect(twice.session).toBe(once.session);
  });
});

describe('both players drop', () => {
  function bothGone() {
    const first = noteDisconnected(timedGame(), 'a', T0);
    return noteDisconnected(first.session, 'b', T0 + 10_000);
  }

  it('does not hand the win to whoever dropped second', () => {
    // A is past grace, B is not. Deciding now would reward B for also leaving.
    const resolved = advanceClock(bothGone().session, T0 + DISCONNECT_GRACE_MS + 1);

    expect(resolved.changed).toBe(false);
    expect(resolved.session.state.phase).toBe('playing');
  });

  it('ends with no winner once neither can come back', () => {
    const resolved = advanceClock(bothGone().session, T0 + 10_000 + DISCONNECT_GRACE_MS);

    expect(resolved.session.state).toMatchObject({
      phase: 'finished',
      winner: null,
      resultReason: 'disconnect',
    });
  });

  it('still lets the returning player win if the other never comes back', () => {
    const back = noteReconnected(bothGone().session, 'b', T0 + 20_000);
    const resolved = advanceClock(back.session, T0 + DISCONNECT_GRACE_MS);

    expect(resolved.session.state).toMatchObject({ winner: 'b', resultReason: 'disconnect' });
  });
});

describe('running out of time on a move', () => {
  it('skips the turn without firing anything', () => {
    const before = timedGame();
    const expired = advanceClock(before, T0 + MOVE_TIMEOUT_MS);

    expect(expired.session.state.turn).toBe('b');
    // No shot was taken, so nothing on either board changed.
    expect(expired.session.state.boards).toBe(before.state.boards);
    expect(expired.session.state.moveCount).toBe(0);
  });

  it('tells both players whose turn lapsed, and how often', () => {
    const expired = advanceClock(timedGame(), T0 + MOVE_TIMEOUT_MS);

    expect(expired.events.a[0]).toEqual({ type: 'turn_skipped', seat: 'a', missedTurns: 1 });
    expect(expired.events.b[0]).toEqual({ type: 'turn_skipped', seat: 'a', missedTurns: 1 });
  });

  it('gives the next player a full fresh 30 seconds', () => {
    const expired = advanceClock(timedGame(), T0 + MOVE_TIMEOUT_MS);
    expect(expired.session.clock.deadline).toBe(T0 + MOVE_TIMEOUT_MS + MOVE_TIMEOUT_MS);
  });

  it('ends the game on the third miss by the same player', () => {
    let session = timedGame();
    let now = T0;

    // A misses three turns in a row; B answers each time so the turn comes back.
    for (let round = 0; round < 3; round += 1) {
      now += MOVE_TIMEOUT_MS;
      const skipped = advanceClock(session, now);
      session = skipped.session;

      if (session.state.phase === 'finished') {
        break;
      }

      // A different empty cell each time: column J is clear of both fixture fleets,
      // and firing the same cell twice would be rejected as a duplicate.
      now += 1_000;
      session = sendAt(
        session,
        PLAYER_B,
        { type: 'fire', cells: [{ x: 9, y: round }] },
        round + 1,
        now,
      ).session;
    }

    expect(session.state).toMatchObject({
      phase: 'finished',
      winner: 'b',
      resultReason: 'timeout',
    });
  });

  it('counts each player’s misses separately', () => {
    let session = timedGame();
    session = advanceClock(session, T0 + MOVE_TIMEOUT_MS).session;
    session = advanceClock(session, T0 + 2 * MOVE_TIMEOUT_MS).session;

    expect(session.clock.missedTurns).toEqual({ a: 1, b: 1 });
    expect(session.state.phase).toBe('playing');
  });
});

describe('running out of time during placement', () => {
  it('places the missing fleets and starts the game', () => {
    const expired = advanceClock(newTimedSession(), T0 + PLACEMENT_TIMEOUT_MS, { seed: 7 });

    expect(expired.session.state.phase).toBe('playing');
    expect(expired.session.state.boards.a.ships).toHaveLength(10);
    expect(expired.session.state.boards.b.ships).toHaveLength(10);
  });

  it('leaves a fleet that was already placed alone', () => {
    const placed = sendAt(
      newTimedSession(),
      PLAYER_A,
      { type: 'place_fleet', placements: [...FLEET_A] },
      0,
      T0,
    ).session;

    const expired = advanceClock(placed, T0 + PLACEMENT_TIMEOUT_MS, { seed: 7 });
    expect(expired.session.state.boards.a.ships).toEqual(placed.state.boards.a.ships);
  });

  it('replays to the same fleets for the same seed', () => {
    const one = advanceClock(newTimedSession(), T0 + PLACEMENT_TIMEOUT_MS, { seed: 42 });
    const two = advanceClock(newTimedSession(), T0 + PLACEMENT_TIMEOUT_MS, { seed: 42 });

    expect(one.session.state.boards.a.ships).toEqual(two.session.state.boards.a.ships);
  });

  it('starts the move clock from the moment placement ended', () => {
    const expired = advanceClock(newTimedSession(), T0 + PLACEMENT_TIMEOUT_MS, { seed: 7 });
    expect(expired.session.clock.deadline).toBe(T0 + PLACEMENT_TIMEOUT_MS + MOVE_TIMEOUT_MS);
  });
});

describe('a finished game is left alone', () => {
  it('ignores every later clock event', () => {
    const resigned = sendAt(timedGame(), PLAYER_A, { type: 'resign' }, 1, T0).session;

    // Whatever arrives afterwards — a late alarm, a socket finally closing — the
    // result is already decided and must not move.
    const dropped = noteDisconnected(resigned, 'b', T0 + 1_000);
    const advanced = advanceClock(dropped.session, T0 + 10_000_000);

    expect(dropped.changed).toBe(false);
    expect(advanced.changed).toBe(false);
    expect(advanced.session.state).toMatchObject({ winner: 'b', resultReason: 'forfeit' });
  });
});

describe('what the timers tell each player', () => {
  it('shows the same deadline to both, and each their own opponent', () => {
    const dropped = noteDisconnected(timedGame(), 'a', T0);

    expect(timersOf(dropped.session, 'b').opponentOffline).toBe(true);
    expect(timersOf(dropped.session, 'a').opponentOffline).toBe(false);
  });

  it('carries the strike count and the limit, so the UI can warn', () => {
    const expired = advanceClock(timedGame(), T0 + MOVE_TIMEOUT_MS);
    const timers = timersOf(expired.session, 'a');

    expect(timers.missedTurns).toEqual({ a: 1, b: 0 });
    expect(timers.maxMissedTurns).toBe(3);
  });
});
