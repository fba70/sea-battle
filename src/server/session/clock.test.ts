import { describe, expect, it } from 'vitest';

import { autoPlaceFleet } from '@/game/autoplace';
import { createRng } from '@/game/rng';
import { createGame, placeFleet, type GameState } from '@/game/state';

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
  MOVE_TIMEOUT_MS,
  PLACEMENT_TIMEOUT_MS,
} from './clock';

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);

const PLACEMENT: GameState = createGame({ firstTurn: 'a' });

function playing(): GameState {
  const withA = placeFleet(PLACEMENT, 'a', autoPlaceFleet(createRng(1)));
  if (!withA.ok) throw new Error('fixture failed');
  const withB = placeFleet(withA.value, 'b', autoPlaceFleet(createRng(2)));
  if (!withB.ok) throw new Error('fixture failed');
  return withB.value;
}

const PLAYING = playing();

describe('the agreed timer values', () => {
  it('are the ones the product decisions set', () => {
    expect(MOVE_TIMEOUT_MS).toBe(30_000);
    expect(PLACEMENT_TIMEOUT_MS).toBe(60_000);
    expect(DISCONNECT_GRACE_MS).toBe(30_000);
    expect(MAX_MISSED_TURNS).toBe(3);
  });
});

describe('starting and restarting the clock', () => {
  it('gives placement its own, longer allowance', () => {
    expect(restart(IDLE_CLOCK, PLACEMENT, T0).deadline).toBe(T0 + PLACEMENT_TIMEOUT_MS);
  });

  it('gives a move the move allowance', () => {
    expect(restart(IDLE_CLOCK, PLAYING, T0).deadline).toBe(T0 + MOVE_TIMEOUT_MS);
  });

  it('runs no deadline at all once the game is over', () => {
    const finished: GameState = { ...PLAYING, phase: 'finished', turn: null };
    expect(restart(IDLE_CLOCK, finished, T0).deadline).toBeNull();
  });

  it('banks the allowance instead of starting it while someone is away', () => {
    const paused = markOffline(restart(IDLE_CLOCK, PLAYING, T0), 'b', T0 + 5_000);
    const next = restart(paused, PLAYING, T0 + 5_000);

    expect(next.deadline).toBeNull();
    expect(next.remainingMs).toBe(MOVE_TIMEOUT_MS);
  });
});

describe('pausing while a player is away', () => {
  it('freezes the clock and keeps what was left', () => {
    const running = restart(IDLE_CLOCK, PLAYING, T0);
    const paused = markOffline(running, 'a', T0 + 10_000);

    expect(isPaused(paused)).toBe(true);
    expect(paused.deadline).toBeNull();
    expect(paused.remainingMs).toBe(20_000);
  });

  it('resumes with the remaining time, not a fresh allowance', () => {
    const paused = markOffline(restart(IDLE_CLOCK, PLAYING, T0), 'a', T0 + 10_000);
    const resumed = markOnline(paused, 'a', T0 + 100_000);

    // 20s were left when they dropped, so 20s are left when they return — however
    // long they were gone.
    expect(resumed.deadline).toBe(T0 + 120_000);
    expect(resumed.remainingMs).toBeNull();
  });

  it('stays frozen until everyone is back', () => {
    let clock = restart(IDLE_CLOCK, PLAYING, T0);
    clock = markOffline(clock, 'a', T0 + 5_000);
    clock = markOffline(clock, 'b', T0 + 6_000);
    clock = markOnline(clock, 'a', T0 + 7_000);

    expect(isPaused(clock)).toBe(true);
    expect(clock.deadline).toBeNull();

    clock = markOnline(clock, 'b', T0 + 8_000);
    expect(clock.deadline).toBe(T0 + 8_000 + 25_000);
  });

  it('does not re-bank time when the second player drops', () => {
    let clock = restart(IDLE_CLOCK, PLAYING, T0);
    clock = markOffline(clock, 'a', T0 + 10_000);
    clock = markOffline(clock, 'b', T0 + 20_000);

    // The 20s banked when A dropped must survive B dropping ten seconds later.
    expect(clock.remainingMs).toBe(20_000);
  });

  it('ignores a repeated disconnect for the same seat', () => {
    const once = markOffline(restart(IDLE_CLOCK, PLAYING, T0), 'a', T0 + 10_000);
    expect(markOffline(once, 'a', T0 + 25_000)).toBe(once);
  });
});

describe('what is due', () => {
  it('is nothing while the deadline is still ahead', () => {
    const clock = restart(IDLE_CLOCK, PLAYING, T0);
    expect(dueAction(clock, PLAYING, T0 + 29_999)).toEqual({ type: 'none' });
  });

  it('expires the turn of whoever is on move', () => {
    const clock = restart(IDLE_CLOCK, PLAYING, T0);
    expect(dueAction(clock, PLAYING, T0 + MOVE_TIMEOUT_MS)).toEqual({
      type: 'turn_expired',
      seat: 'a',
    });
  });

  it('auto-places when the placement deadline passes', () => {
    const clock = restart(IDLE_CLOCK, PLACEMENT, T0);
    expect(dueAction(clock, PLACEMENT, T0 + PLACEMENT_TIMEOUT_MS)).toEqual({ type: 'auto_place' });
  });

  it('never expires a turn while someone is away', () => {
    const clock = markOffline(restart(IDLE_CLOCK, PLAYING, T0), 'b', T0 + 1_000);
    // Long past the original move deadline, but the clock was frozen.
    expect(dueAction(clock, PLAYING, T0 + 29_000)).toEqual({ type: 'none' });
  });

  it('decides against a player who misses the grace window', () => {
    const clock = markOffline(restart(IDLE_CLOCK, PLAYING, T0), 'b', T0);
    expect(dueAction(clock, PLAYING, T0 + DISCONNECT_GRACE_MS)).toEqual({
      type: 'disconnect_loss',
      seat: 'b',
    });
  });

  it('waits out the grace window before deciding anything', () => {
    const clock = markOffline(restart(IDLE_CLOCK, PLAYING, T0), 'b', T0);
    expect(dueAction(clock, PLAYING, T0 + DISCONNECT_GRACE_MS - 1)).toEqual({ type: 'none' });
  });

  it('does nothing to a game that is already over', () => {
    const finished: GameState = { ...PLAYING, phase: 'finished' };
    const clock = markOffline(restart(IDLE_CLOCK, PLAYING, T0), 'b', T0);
    expect(dueAction(clock, finished, T0 + 999_999)).toEqual({ type: 'none' });
  });

  describe('when both players are away', () => {
    const bothAway = (() => {
      let clock = restart(IDLE_CLOCK, PLAYING, T0);
      clock = markOffline(clock, 'a', T0);
      return markOffline(clock, 'b', T0 + 10_000);
    })();

    it('waits for the later grace rather than blaming whoever dropped first', () => {
      // A's grace has expired, B's has not. Awarding the win to B here would hand a
      // rated win to someone who may also never come back.
      expect(dueAction(bothAway, PLAYING, T0 + DISCONNECT_GRACE_MS + 1)).toEqual({ type: 'none' });
    });

    it('ends with no winner once both graces have run out', () => {
      expect(dueAction(bothAway, PLAYING, T0 + 10_000 + DISCONNECT_GRACE_MS)).toEqual({
        type: 'abandoned',
      });
    });

    it('lets the one who comes back win, if the other never does', () => {
      const bReturned = markOnline(bothAway, 'b', T0 + 20_000);
      expect(dueAction(bReturned, PLAYING, T0 + 30_000)).toEqual({
        type: 'disconnect_loss',
        seat: 'a',
      });
    });
  });
});

describe('when to wake up', () => {
  it('is the running deadline when everyone is present', () => {
    expect(wakeAt(restart(IDLE_CLOCK, PLAYING, T0), PLAYING)).toBe(T0 + MOVE_TIMEOUT_MS);
  });

  it('is the grace deadline while one player is away', () => {
    const clock = markOffline(restart(IDLE_CLOCK, PLAYING, T0), 'a', T0 + 5_000);
    expect(wakeAt(clock, PLAYING)).toBe(T0 + 5_000 + DISCONNECT_GRACE_MS);
  });

  it('is the later grace deadline while both are away', () => {
    let clock = restart(IDLE_CLOCK, PLAYING, T0);
    clock = markOffline(clock, 'a', T0);
    clock = markOffline(clock, 'b', T0 + 10_000);

    expect(wakeAt(clock, PLAYING)).toBe(T0 + 10_000 + DISCONNECT_GRACE_MS);
  });

  it('is never, once the game is finished', () => {
    expect(wakeAt(restart(IDLE_CLOCK, PLAYING, T0), { ...PLAYING, phase: 'finished' })).toBeNull();
  });

  it('is never, when no deadline is running', () => {
    expect(wakeAt(stop(IDLE_CLOCK), PLAYING)).toBeNull();
  });
});

describe('missed turns', () => {
  it('counts per seat', () => {
    const clock = countMissedTurn(countMissedTurn(IDLE_CLOCK, 'a'), 'b');
    expect(clock.missedTurns).toEqual({ a: 1, b: 1 });
  });

  it('ends the game on the third miss, not the second', () => {
    let clock = IDLE_CLOCK;
    clock = countMissedTurn(clock, 'a');
    expect(hasTimedOut(clock, 'a')).toBe(false);
    clock = countMissedTurn(clock, 'a');
    expect(hasTimedOut(clock, 'a')).toBe(false);
    clock = countMissedTurn(clock, 'a');
    expect(hasTimedOut(clock, 'a')).toBe(true);
    // The other player's patience is their own.
    expect(hasTimedOut(clock, 'b')).toBe(false);
  });
});
