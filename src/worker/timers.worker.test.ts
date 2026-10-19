import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { FLEET_A, FLEET_B } from '@/game/testing/fixtures';
import type { PlayerSlot, ShipPlacement } from '@/game/types';
import type { ClientIntent, ServerEvent } from '@/server/session/protocol';
import { DISCONNECT_GRACE_MS, MOVE_TIMEOUT_MS, PLACEMENT_TIMEOUT_MS } from '@/server/session/clock';
import { mintGameTicket } from '@/server/ticket';

/**
 * Timers, disconnects and resignation through the real Workers runtime (spec §4).
 *
 * The arithmetic — when a deadline falls, who loses, when nobody does — is covered by
 * the pure clock tests. What is only testable here is the wiring: that closing a
 * socket starts a grace window, that an alarm is actually booked, and that running it
 * ends the game the way the session said it would.
 *
 * Deadlines are reached by rewinding the stored clock rather than by waiting, which
 * keeps the suite fast and deterministic.
 */

let nextGame = 0;
const freshGameId = () => `timer-${(nextGame += 1)}-${Math.random().toString(36).slice(2, 8)}`;

interface Client {
  readonly received: ServerEvent[];
  send(intent: ClientIntent, seq: number): void;
  close(): void;
}

async function connect(gameId: string, playerId: string, seat: PlayerSlot): Promise<Client> {
  const ticket = await mintGameTicket({ gameId, playerId, seat }, env.GAME_TICKET_SECRET);
  const response = await SELF.fetch(
    `https://game.test/game/${gameId}/ws?ticket=${encodeURIComponent(ticket)}`,
    { headers: { Upgrade: 'websocket' } },
  );

  const socket = response.webSocket;
  if (!socket) {
    throw new Error('no websocket on the upgrade response');
  }

  const received: ServerEvent[] = [];
  socket.accept();
  socket.addEventListener('message', (event) => {
    received.push(JSON.parse(event.data as string) as ServerEvent);
  });

  return {
    received,
    send: (intent, seq) => socket.send(JSON.stringify({ seq, intent })),
    close: () => socket.close(1000, 'test'),
  };
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 6; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const place = (placements: readonly ShipPlacement[]): ClientIntent => ({
  type: 'place_fleet',
  placements: [...placements],
});

const typesOf = (events: readonly ServerEvent[]) => events.map((event) => event.type);
const lastSnapshot = (events: readonly ServerEvent[]) =>
  [...events].reverse().find((event) => event.type === 'state_snapshot');

async function startedMatch() {
  const gameId = freshGameId();
  const a = await connect(gameId, 'player-a', 'a');
  const b = await connect(gameId, 'player-b', 'b');
  await settle();

  a.send(place(FLEET_A), 0);
  b.send(place(FLEET_B), 0);
  await settle();

  return { gameId, a, b };
}

const stubFor = (gameId: string) => env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId));

/** Moves the stored clock back so a deadline that is `by` ms away has already passed. */
async function rewindClock(gameId: string, by: number): Promise<void> {
  await runInDurableObject(stubFor(gameId), async (instance: Record<string, unknown>, state) => {
    const room = (await state.storage.get('room')) as Record<string, unknown>;
    const clock = room.clock as {
      deadline: number | null;
      offlineSince: { a: number | null; b: number | null };
    };

    await state.storage.put('room', {
      ...room,
      clock: {
        ...clock,
        deadline: clock.deadline === null ? null : clock.deadline - by,
        offlineSince: {
          a: clock.offlineSince.a === null ? null : clock.offlineSince.a - by,
          b: clock.offlineSince.b === null ? null : clock.offlineSince.b - by,
        },
      },
    });

    // Force a rehydrate so the alarm reads what was just written.
    instance.room = null;
    instance.session = null;
  });
}

describe('the clock is running', () => {
  it('tells both players when the current turn ends', async () => {
    const { a } = await startedMatch();
    const timers = lastSnapshot(a.received)?.timers;

    expect(timers?.paused).toBe(false);
    expect(timers?.deadlineTs).toBeGreaterThan(Date.now());
    expect(timers?.deadlineTs).toBeLessThanOrEqual(Date.now() + MOVE_TIMEOUT_MS);
  });

  it('books the placement alarm as soon as both players are in', async () => {
    // The dangerous case: if the alarm were only booked when someone acts, two
    // players who both sit still would wait out a placement clock that never fires.
    const gameId = freshGameId();
    await connect(gameId, 'player-a', 'a');
    await connect(gameId, 'player-b', 'b');
    await settle();

    const alarm = await runInDurableObject(stubFor(gameId), (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).not.toBeNull();
  });

  it('books an alarm for the deadline', async () => {
    const { gameId } = await startedMatch();

    const alarm = await runInDurableObject(stubFor(gameId), (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).not.toBeNull();
  });
});

describe('resigning', () => {
  it('ends the game at once for both players', async () => {
    const { a, b } = await startedMatch();

    a.send({ type: 'resign' }, 1);
    await settle();

    expect(typesOf(a.received)).toContain('game_over');
    expect(typesOf(b.received)).toContain('game_over');
    expect(lastSnapshot(b.received)?.view).toMatchObject({
      phase: 'finished',
      winner: 'b',
      resultReason: 'forfeit',
    });
  });

  it('stops the clock, so no deadline is left pending', async () => {
    const { gameId, a } = await startedMatch();

    a.send({ type: 'resign' }, 1);
    await settle();

    const clock = await runInDurableObject(stubFor(gameId), async (_instance, state) => {
      const room = (await state.storage.get('room')) as { clock: { deadline: number | null } };
      return room.clock;
    });

    expect(clock.deadline).toBeNull();
  });

  it('tries the report again when a player opens the finished game', async () => {
    /**
     * Recovery for a result that never reached the app. The row stays open until it
     * does, and an open row is what matchmaking keeps handing back — so every door
     * into the room has to retry, not just the move that ended it.
     */
    const { gameId, a } = await startedMatch();

    a.send({ type: 'resign' }, 1);
    await settle();

    // Pretend the report never landed, and drop the in-memory instance with it.
    await runInDurableObject(stubFor(gameId), async (instance: Record<string, unknown>, state) => {
      const room = (await state.storage.get('room')) as Record<string, unknown>;
      await state.storage.put('room', { ...room, reported: false, reportAttempts: 1 });
      instance.room = null;
      instance.session = null;
    });

    await connect(gameId, 'player-b', 'b');
    await settle();

    const room = await runInDurableObject(
      stubFor(gameId),
      async (_instance, state) => (await state.storage.get('room')) as { reported: boolean },
    );

    expect(room.reported).toBe(true);
  });

  it('reports the finished match, so the result is not lost', async () => {
    const { gameId, a } = await startedMatch();

    a.send({ type: 'resign' }, 1);
    await settle();

    const room = await runInDurableObject(
      stubFor(gameId),
      async (_instance, state) =>
        (await state.storage.get('room')) as { reported: boolean; reportAttempts?: number },
    );

    expect(room.reported).toBe(true);
    expect(room.reportAttempts ?? 0).toBe(0);
  });

  it('books an alarm for the deadline', async () => {
    const { gameId } = await startedMatch();

    const alarm = await runInDurableObject(stubFor(gameId), (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).not.toBeNull();
  });
});

describe('resigning', () => {
  it('ends the game at once for both players', async () => {
    const { a, b } = await startedMatch();

    a.send({ type: 'resign' }, 1);
    await settle();

    expect(typesOf(a.received)).toContain('game_over');
    expect(typesOf(b.received)).toContain('game_over');
    expect(lastSnapshot(b.received)?.view).toMatchObject({
      phase: 'finished',
      winner: 'b',
      resultReason: 'forfeit',
    });
  });

  it('stops the clock, so no deadline is left pending', async () => {
    const { gameId, a } = await startedMatch();

    a.send({ type: 'resign' }, 1);
    await settle();

    const clock = await runInDurableObject(stubFor(gameId), async (_instance, state) => {
      const room = (await state.storage.get('room')) as { clock: { deadline: number | null } };
      return room.clock;
    });

    expect(clock.deadline).toBeNull();
  });
});

describe('the rating after a rated match', () => {
  /** Stands in for what the app answers the result report with. */
  const REPORT = {
    rated: true,
    a: { delta: 12.4, rating: 1512.4, gamesRated: 11 },
    b: { delta: -12.4, rating: 1487.6, gamesRated: 7 },
  };

  async function storeRating(gameId: string): Promise<void> {
    await runInDurableObject(stubFor(gameId), async (instance: Record<string, unknown>, state) => {
      const room = (await state.storage.get('room')) as Record<string, unknown>;
      await state.storage.put('room', { ...room, rating: REPORT });
      instance.room = null;
      instance.session = null;
    });
  }

  it('tells a returning player their own numbers, not their opponent’s', async () => {
    /**
     * The recovery path: the live message is sent once when the app records the
     * result, so a reload would miss it. The room keeps the report and re-sends it
     * on every connect.
     */
    const { gameId, a } = await startedMatch();
    a.send({ type: 'resign' }, 1);
    await settle();
    await storeRating(gameId);

    const returning = await connect(gameId, 'player-a', 'a');
    await settle();

    const event = returning.received.find((e) => e.type === 'rating_applied');
    expect(event).toEqual({ type: 'rating_applied', rated: true, summary: REPORT.a });
  });

  it('gives each seat its own side of the result', async () => {
    const { gameId, a } = await startedMatch();
    a.send({ type: 'resign' }, 1);
    await settle();
    await storeRating(gameId);

    const seatB = await connect(gameId, 'player-b', 'b');
    await settle();

    const event = seatB.received.find((e) => e.type === 'rating_applied');
    expect(event).toEqual({ type: 'rating_applied', rated: true, summary: REPORT.b });
  });

  it('says a match was unrated rather than leaving the player waiting', async () => {
    const { gameId, a } = await startedMatch();
    a.send({ type: 'resign' }, 1);
    await settle();

    await runInDurableObject(stubFor(gameId), async (instance: Record<string, unknown>, state) => {
      const room = (await state.storage.get('room')) as Record<string, unknown>;
      await state.storage.put('room', { ...room, rating: { rated: false } });
      instance.room = null;
      instance.session = null;
    });

    const returning = await connect(gameId, 'player-a', 'a');
    await settle();

    expect(returning.received.find((e) => e.type === 'rating_applied')).toEqual({
      type: 'rating_applied',
      rated: false,
    });
  });

  it('says nothing about rating while the match is still being played', async () => {
    const { a } = await startedMatch();
    expect(a.received.some((event) => event.type === 'rating_applied')).toBe(false);
  });
});

describe('a player drops', () => {
  it('warns the player who is still there, with a deadline', async () => {
    const { a, b } = await startedMatch();

    b.close();
    await settle();

    const warning = a.received.find((event) => event.type === 'opponent_disconnected');
    expect(warning).toMatchObject({ seat: 'b' });
    expect(lastSnapshot(a.received)?.timers).toMatchObject({ opponentOffline: true, paused: true });
  });

  it('resumes the match when they come back', async () => {
    const { gameId, a, b } = await startedMatch();

    b.close();
    await settle();
    await connect(gameId, 'player-b', 'b');
    await settle();

    expect(typesOf(a.received)).toContain('opponent_reconnected');
    expect(lastSnapshot(a.received)?.timers).toMatchObject({
      opponentOffline: false,
      paused: false,
    });
  });

  it('loses the game for them once the grace window has passed', async () => {
    const { gameId, a, b } = await startedMatch();

    b.close();
    await settle();
    await rewindClock(gameId, DISCONNECT_GRACE_MS + 1_000);

    expect(await runDurableObjectAlarm(stubFor(gameId))).toBe(true);
    await settle();

    expect(lastSnapshot(a.received)?.view).toMatchObject({
      phase: 'finished',
      winner: 'a',
      resultReason: 'disconnect',
    });
  });
});

describe('both players drop', () => {
  it('ends with no winner rather than rewarding whoever left second', async () => {
    const { gameId, a, b } = await startedMatch();

    a.close();
    b.close();
    await settle();
    await rewindClock(gameId, DISCONNECT_GRACE_MS + 1_000);

    expect(await runDurableObjectAlarm(stubFor(gameId))).toBe(true);

    const state = await runInDurableObject(stubFor(gameId), async (_instance, storageState) => {
      const room = (await storageState.storage.get('room')) as {
        state: { phase: string; winner: unknown; resultReason: unknown };
      };
      return room.state;
    });

    // No winner is what keeps the rating layer from awarding anything: its
    // eligibility check refuses a game with no result to rate.
    expect(state.phase).toBe('finished');
    expect(state.winner).toBeNull();
    expect(state.resultReason).toBe('disconnect');
  });

  it('can still be restored afterwards, and tells a returning player the result', async () => {
    /**
     * The regression this exists for: an abandoned game has no winner, which the
     * codec used to reject. The state persisted fine but could never be read back,
     * so the room threw on every wake — logging "stored game state is invalid:
     * inconsistent_state" over and over, never reporting its result, and leaving the
     * database row open forever.
     */
    const { gameId, a, b } = await startedMatch();

    a.close();
    b.close();
    await settle();
    await rewindClock(gameId, DISCONNECT_GRACE_MS + 1_000);
    await runDurableObjectAlarm(stubFor(gameId));

    // Drop the in-memory instance so the next request must rebuild from storage.
    await runInDurableObject(stubFor(gameId), (instance: Record<string, unknown>) => {
      instance.room = null;
      instance.session = null;
    });

    const returning = await connect(gameId, 'player-a', 'a');
    await settle();

    expect(lastSnapshot(returning.received)?.view).toMatchObject({
      phase: 'finished',
      winner: null,
      resultReason: 'disconnect',
    });
  });

  it('still records the result, even though nobody is left to trigger it', async () => {
    // The reliability case Block 9 introduces: before, a game only ended on a move,
    // so somebody was always connected to carry the report. Now the alarm has to.
    const { gameId, a, b } = await startedMatch();

    a.close();
    b.close();
    await settle();
    await rewindClock(gameId, DISCONNECT_GRACE_MS + 1_000);
    await runDurableObjectAlarm(stubFor(gameId));

    const room = await runInDurableObject(
      stubFor(gameId),
      async (_instance, state) => (await state.storage.get('room')) as { reported: boolean },
    );

    expect(room.reported).toBe(true);
  });
});

describe('running out of time during placement', () => {
  async function expirePlacement() {
    const gameId = freshGameId();
    const a = await connect(gameId, 'player-a', 'a');
    await connect(gameId, 'player-b', 'b');
    await settle();

    await rewindClock(gameId, PLACEMENT_TIMEOUT_MS + 1_000);
    expect(await runDurableObjectAlarm(stubFor(gameId))).toBe(true);
    await settle();

    return lastSnapshot(a.received)?.view;
  }

  it('places the missing fleet and starts the game', async () => {
    const view = await expirePlacement();

    expect(view?.phase).toBe('playing');
    expect(view?.own.ships).toHaveLength(10);
  });

  it('does not place a fleet an opponent could have predicted', async () => {
    /**
     * SECURITY: the seed must come from the runtime's CSPRNG, not from the game id
     * or the revision — both players know those, and a derived seed would hand the
     * opponent the exact fleet to shoot at. Two independent games producing
     * identical placements would mean the seed had become predictable again.
     */
    const first = await expirePlacement();
    const second = await expirePlacement();

    expect(first?.own.ships).not.toEqual(second?.own.ships);
  });
});

describe('running out of time', () => {
  it('skips the turn instead of firing a shot nobody chose', async () => {
    const { gameId, a } = await startedMatch();
    const before = lastSnapshot(a.received)?.view;

    await rewindClock(gameId, MOVE_TIMEOUT_MS + 1_000);
    expect(await runDurableObjectAlarm(stubFor(gameId))).toBe(true);
    await settle();

    const after = lastSnapshot(a.received)?.view;
    expect(typesOf(a.received)).toContain('turn_skipped');
    expect(after?.turn).not.toBe(before?.turn);
    // Nothing was fired, so no cell was revealed on either board.
    expect(after?.moveCount).toBe(before?.moveCount);
  });

  it('counts the miss against the player who let it lapse', async () => {
    const { gameId, a } = await startedMatch();
    const onTurn = lastSnapshot(a.received)?.view.turn as PlayerSlot;

    await rewindClock(gameId, MOVE_TIMEOUT_MS + 1_000);
    await runDurableObjectAlarm(stubFor(gameId));
    await settle();

    expect(lastSnapshot(a.received)?.timers.missedTurns[onTurn]).toBe(1);
  });
});
