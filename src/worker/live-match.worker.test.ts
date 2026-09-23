import { env, evictDurableObject, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { FLEET_A, FLEET_B } from '@/game/testing/fixtures';
import type { Coord, PlayerSlot, ShipPlacement } from '@/game/types';
import { cellsOfPlacement } from '@/game/placement';
import type { ClientIntent, ServerEvent } from '@/server/session/protocol';
import { mintGameTicket } from '@/server/ticket';

/**
 * Block 6: one complete authoritative PvP match, end to end through the real runtime.
 *
 * join → placement → ready → battle → game over → result reported, with the browser
 * deciding nothing. Every rule comes from `src/game`, every payload from
 * `GameSession`, and the outcome is reported to the Next app rather than written here.
 */

let counter = 0;
function freshGameId(prefix = 'match'): string {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

interface Client {
  readonly socket: WebSocket;
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
  expect(response.status).toBe(101);

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
    socket,
    received,
    send: (intent, seq) => socket.send(JSON.stringify({ seq, intent })),
    close: () => socket.close(),
  };
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 6; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function lastSnapshot(events: readonly ServerEvent[]) {
  return [...events].reverse().find((event) => event.type === 'state_snapshot');
}

function cellsOf(fleet: readonly ShipPlacement[]): Coord[] {
  return fleet.flatMap((placement) => cellsOfPlacement(placement));
}

/** Reads the durable room record, to assert on what actually survived. */
async function roomOf(gameId: string): Promise<Record<string, unknown> | undefined> {
  const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId));
  return runInDurableObject(stub, async (_instance, state) =>
    state.storage.get<Record<string, unknown>>('room'),
  );
}

/**
 * Plays a full match to a decided result.
 *
 * Classic keeps the turn on a hit (spec §4), so whoever moves first can sink the whole
 * opposing fleet without the other player ever firing — which makes the outcome
 * deterministic even though the server picks the first turn at random.
 */
async function playToCompletion(gameId: string) {
  const a = await connect(gameId, 'player-a', 'a');
  const b = await connect(gameId, 'player-b', 'b');
  await settle();

  // Placement, then the §9 `ready` confirmation.
  a.send({ type: 'place_fleet', placements: [...FLEET_A] }, 0);
  b.send({ type: 'place_fleet', placements: [...FLEET_B] }, 0);
  await settle();
  a.send({ type: 'ready' }, 1);
  b.send({ type: 'ready' }, 1);
  await settle();

  const started = lastSnapshot(a.received);
  expect(started?.view.phase).toBe('playing');

  const firstTurn = started?.view.turn as PlayerSlot;
  const mover = firstTurn === 'a' ? a : b;
  const targets = cellsOf(firstTurn === 'a' ? FLEET_B : FLEET_A);

  let seq = 2;
  for (const cell of targets) {
    mover.send({ type: 'fire', cells: [cell] }, seq);
    seq += 1;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  await settle();

  return { a, b, firstTurn, mover, shots: targets.length };
}

describe('a complete authoritative match', () => {
  it('runs join → placement → ready → battle → game over', async () => {
    const gameId = freshGameId();
    const { a, b, firstTurn, shots } = await playToCompletion(gameId);

    for (const client of [a, b]) {
      const view = lastSnapshot(client.received)?.view;
      expect(view?.phase).toBe('finished');
      expect(view?.winner).toBe(firstTurn);
      // 20 ship cells, every one a hit, so no turn ever passed.
      expect(view?.moveCount).toBe(shots);
    }

    // Both players are told the game is over, with the same public result.
    for (const client of [a, b]) {
      const over = client.received.find((event) => event.type === 'game_over');
      expect(over).toEqual({ type: 'game_over', winner: firstTurn, reason: 'sunk_all' });
    }
  });

  it('broadcasts hits and sinkings to both players as they happen', async () => {
    const gameId = freshGameId();
    const { a, b } = await playToCompletion(gameId);

    for (const client of [a, b]) {
      const outcomes = client.received
        .filter((event) => event.type === 'fire_result')
        .flatMap((event) => (event.type === 'fire_result' ? event.cells : []))
        .map((cell) => cell.outcome);

      // Every shot landed; ten of them finished a ship.
      expect(outcomes.filter((outcome) => outcome === 'miss')).toHaveLength(0);
      expect(outcomes.filter((outcome) => outcome === 'sunk')).toHaveLength(10);

      const sunk = client.received.filter((event) => event.type === 'ship_sunk');
      expect(sunk).toHaveLength(10);
      // A sunk ship reveals its outline and its buffer to both sides (spec §4).
      expect(sunk.every((event) => event.type === 'ship_sunk' && event.outline.length > 0)).toBe(
        true,
      );
    }
  });

  it('never lets the losing player learn anything about the winner board', async () => {
    const gameId = freshGameId();
    const { a, b, firstTurn } = await playToCompletion(gameId);

    // The loser never fired a shot, so they must still know nothing about the
    // winner's board — not even now that the game is over.
    const loser = firstTurn === 'a' ? b : a;
    const view = lastSnapshot(loser.received)?.view;

    expect(view?.viewer).toBe(firstTurn === 'a' ? 'b' : 'a');
    expect(view?.opponent.sunkShips).toEqual([]);
    expect(view?.opponent.shotsFired).toBe(0);
    expect(view?.opponent.grid.flat().every((cell) => cell === 'unknown')).toBe(true);

    // Their own destroyed fleet is legitimately theirs to see.
    expect(view?.own.ships).toHaveLength(10);
    expect(view?.own.shipsRemaining).toBe(0);
  });

  it('refuses a shot after the game is over', async () => {
    const gameId = freshGameId();
    const { mover } = await playToCompletion(gameId);
    mover.received.length = 0;

    mover.send({ type: 'fire', cells: [{ x: 9, y: 9 }] }, 999);
    await settle();

    expect(mover.received[0]).toMatchObject({ type: 'error', code: 'wrong_phase' });
  });
});

describe('reporting the result to the Next app', () => {
  it('reports the finished match exactly once', async () => {
    const gameId = freshGameId();
    await playToCompletion(gameId);

    const room = await roomOf(gameId);
    expect(room?.reported).toBe(true);
  });

  it('does not report again when the room wakes later', async () => {
    const gameId = freshGameId();
    const { a } = await playToCompletion(gameId);

    await evictDurableObject(env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId)));

    a.send({ type: 'join', gameId }, 500);
    await settle();

    // Still reported, and the flag was never reset by the rehydrate.
    expect((await roomOf(gameId))?.reported).toBe(true);
  });

  it('leaves the match unreported when the Next app rejects it, so it can be retried', async () => {
    // The outbound stub fails for a game id containing `failreport`.
    const gameId = freshGameId('failreport');
    const { a } = await playToCompletion(gameId);

    expect((await roomOf(gameId))?.reported).toBe(false);

    // The game itself is unaffected — the result is durable in the room either way.
    const view = lastSnapshot(a.received)?.view;
    expect(view?.phase).toBe('finished');
  });

  it('does not report a match that is still in play', async () => {
    const gameId = freshGameId();
    const a = await connect(gameId, 'player-a', 'a');
    const b = await connect(gameId, 'player-b', 'b');
    await settle();
    a.send({ type: 'place_fleet', placements: [...FLEET_A] }, 0);
    b.send({ type: 'place_fleet', placements: [...FLEET_B] }, 0);
    await settle();

    expect((await roomOf(gameId))?.reported).toBe(false);
  });
});

describe('the finished match survives hibernation', () => {
  it('returns the same authoritative result after an eviction', async () => {
    const gameId = freshGameId();
    const { a, firstTurn } = await playToCompletion(gameId);
    const before = lastSnapshot(a.received)?.view;

    await evictDurableObject(env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId)));

    a.send({ type: 'join', gameId }, 600);
    await settle();

    const after = lastSnapshot(a.received)?.view;
    expect(after).toEqual(before);
    expect(after?.winner).toBe(firstTurn);
  });

  it('gives a reconnecting player the finished state', async () => {
    const gameId = freshGameId();
    const { firstTurn } = await playToCompletion(gameId);

    const rejoined = await connect(gameId, 'player-b', 'b');
    await settle();

    const view = lastSnapshot(rejoined.received)?.view;
    expect(view?.phase).toBe('finished');
    expect(view?.winner).toBe(firstTurn);
    expect(view?.viewer).toBe('b');
  });
});
