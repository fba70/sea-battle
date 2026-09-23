import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { FLEET_A, FLEET_B } from '@/game/testing/fixtures';
import type { Coord, PlayerSlot, ShipPlacement } from '@/game/types';
import type { ClientIntent, ServerEvent } from '@/server/session/protocol';
import { mintGameTicket } from '@/server/ticket';

/**
 * End-to-end through the real Workers runtime: a Worker, a Durable Object, real
 * WebSockets, real durable storage. Nothing is deployed and no Cloudflare account is
 * involved — Miniflare runs workerd locally.
 */

/** A miss on both fixture fleets: columns I and J are empty in each. */
const ALWAYS_MISS: Coord = { x: 9, y: 9 };

let nextGame = 0;
function freshGameId(): string {
  nextGame += 1;
  return `game-${nextGame}-${Math.random().toString(36).slice(2, 8)}`;
}

interface Client {
  readonly socket: WebSocket;
  readonly received: ServerEvent[];
  send(intent: ClientIntent, seq: number): void;
  close(): void;
}

async function ticketFor(gameId: string, playerId: string, seat: PlayerSlot): Promise<string> {
  return mintGameTicket({ gameId, playerId, seat }, env.GAME_TICKET_SECRET);
}

async function connectWith(gameId: string, ticket: string): Promise<Response> {
  return SELF.fetch(`https://game.test/game/${gameId}/ws?ticket=${encodeURIComponent(ticket)}`, {
    headers: { Upgrade: 'websocket' },
  });
}

async function connect(gameId: string, playerId: string, seat: PlayerSlot): Promise<Client> {
  const response = await connectWith(gameId, await ticketFor(gameId, playerId, seat));
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

/** Waits for the socket traffic to settle so assertions see the full exchange. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function typesOf(events: readonly ServerEvent[]): string[] {
  return events.map((event) => event.type);
}

function lastSnapshot(events: readonly ServerEvent[]) {
  return [...events].reverse().find((event) => event.type === 'state_snapshot');
}

const place = (placements: readonly ShipPlacement[]): ClientIntent => ({
  type: 'place_fleet',
  placements: [...placements],
});

const fire = (coord: Coord): ClientIntent => ({ type: 'fire', cells: [coord] });

/** Both players connected, both fleets placed, game in play. */
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

describe('connecting', () => {
  it('upgrades a connection that presents a valid ticket', async () => {
    const gameId = freshGameId();
    const response = await connectWith(gameId, await ticketFor(gameId, 'player-a', 'a'));

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeTruthy();
  });

  it('refuses a request that is not a websocket upgrade', async () => {
    const gameId = freshGameId();
    const ticket = await ticketFor(gameId, 'player-a', 'a');
    const response = await SELF.fetch(
      `https://game.test/game/${gameId}/ws?ticket=${encodeURIComponent(ticket)}`,
    );

    expect(response.status).toBe(426);
  });

  it('refuses an unknown route', async () => {
    expect((await SELF.fetch('https://game.test/nope')).status).toBe(404);
  });

  it('refuses a missing ticket', async () => {
    const response = await connectWith(freshGameId(), '');
    expect(response.status).toBe(401);
  });

  it('refuses a forged ticket', async () => {
    const gameId = freshGameId();
    const forged = await mintGameTicket(
      { gameId, playerId: 'attacker', seat: 'a' },
      'the-wrong-secret',
    );

    const response = await connectWith(gameId, forged);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('bad_signature');
  });

  it('refuses an expired ticket', async () => {
    const gameId = freshGameId();
    const stale = await mintGameTicket(
      { gameId, playerId: 'player-a', seat: 'a', exp: Math.floor(Date.now() / 1000) - 5 },
      env.GAME_TICKET_SECRET,
    );

    expect((await connectWith(gameId, stale)).status).toBe(401);
  });

  it('refuses a ticket minted for a different game', async () => {
    const other = await ticketFor(freshGameId(), 'player-a', 'a');
    const response = await connectWith(freshGameId(), other);

    expect(response.status).toBe(403);
  });

  it('refuses a second player trying to take a seat that is already held', async () => {
    const gameId = freshGameId();
    await connect(gameId, 'player-a', 'a');

    const intruder = await ticketFor(gameId, 'someone-else', 'a');
    const response = await connectWith(gameId, intruder);

    expect(response.status).toBe(409);
    expect(await response.text()).toBe('seat_taken');
  });

  it('refuses one player holding both seats', async () => {
    const gameId = freshGameId();
    await connect(gameId, 'player-a', 'a');

    const response = await connectWith(gameId, await ticketFor(gameId, 'player-a', 'b'));
    expect(response.status).toBe(409);
  });

  it('tells the first player to wait until the opponent arrives', async () => {
    const gameId = freshGameId();
    const a = await connect(gameId, 'player-a', 'a');
    await settle();

    expect(typesOf(a.received)).toEqual(['error']);
  });

  it('sends both players a snapshot once the second one connects', async () => {
    const gameId = freshGameId();
    const a = await connect(gameId, 'player-a', 'a');
    const b = await connect(gameId, 'player-b', 'b');
    await settle();

    expect(typesOf(a.received)).toContain('state_snapshot');
    expect(typesOf(b.received)).toContain('state_snapshot');
    expect(lastSnapshot(a.received)?.view.viewer).toBe('a');
    expect(lastSnapshot(b.received)?.view.viewer).toBe('b');
  });
});

describe('playing a match through the socket', () => {
  it('runs placement and firing entirely through the existing session', async () => {
    const { a, b } = await startedMatch();

    expect(typesOf(a.received)).toContain('placement_accepted');
    expect(lastSnapshot(a.received)?.view.phase).toBe('playing');
    expect(lastSnapshot(b.received)?.view.phase).toBe('playing');

    const firstTurn = lastSnapshot(a.received)?.view.turn;
    const mover = firstTurn === 'a' ? a : b;

    mover.send(fire(ALWAYS_MISS), 1);
    await settle();

    const result = a.received.find((event) => event.type === 'fire_result');
    expect(result).toMatchObject({ cells: [{ coord: ALWAYS_MISS, outcome: 'miss' }] });
    // Both players learn the shot happened.
    expect(typesOf(b.received)).toContain('fire_result');
  });

  it('rejects a shot from the player whose turn it is not', async () => {
    const { a, b } = await startedMatch();
    const turn = lastSnapshot(a.received)?.view.turn;
    const idle = turn === 'a' ? b : a;

    idle.received.length = 0;
    idle.send(fire(ALWAYS_MISS), 1);
    await settle();

    expect(idle.received).toEqual([
      { type: 'error', code: 'not_your_turn', message: expect.any(String) },
    ]);
  });

  it('rejects placing a fleet twice', async () => {
    const { a } = await startedMatch();
    a.received.length = 0;
    a.send(place(FLEET_A), 5);
    await settle();

    expect(a.received[0]).toMatchObject({ type: 'placement_rejected', reason: 'wrong_phase' });
  });

  it('applies an accepted intent only once when it is replayed', async () => {
    const { a, b } = await startedMatch();
    const turn = lastSnapshot(a.received)?.view.turn;
    const mover = turn === 'a' ? a : b;

    mover.send(fire(ALWAYS_MISS), 1);
    await settle();
    const afterFirst = lastSnapshot(mover.received)?.view.moveCount;

    // Same seq, same intent — spec §10 replay protection, preserved from Block 1.
    mover.send(fire(ALWAYS_MISS), 1);
    await settle();

    expect(lastSnapshot(mover.received)?.view.moveCount).toBe(afterFirst);
  });
});

describe('malformed and untrusted input', () => {
  const BAD_FRAMES: readonly [string, string][] = [
    ['not JSON', 'fire A1'],
    ['a JSON scalar', '"fire"'],
    ['a missing seq', JSON.stringify({ intent: { type: 'ready' } })],
    ['an unknown intent', JSON.stringify({ seq: 0, intent: { type: 'nuke' } })],
    ['an unknown key', JSON.stringify({ seq: 0, intent: { type: 'ready' }, cheat: true })],
    [
      'a string coordinate',
      JSON.stringify({ seq: 1, intent: { type: 'fire', cells: [{ x: '0', y: 0 }] } }),
    ],
    [
      'an oversized salvo',
      JSON.stringify({
        seq: 1,
        intent: { type: 'fire', cells: Array.from({ length: 50 }, () => ({ x: 0, y: 0 })) },
      }),
    ],
  ];

  for (const [label, frame] of BAD_FRAMES) {
    it(`rejects ${label} without disturbing the game`, async () => {
      const { a } = await startedMatch();
      const before = lastSnapshot(a.received)?.view.moveCount ?? 0;
      a.received.length = 0;

      a.socket.send(frame);
      await settle();

      expect(a.received[0]).toMatchObject({ type: 'error', code: 'malformed_intent' });

      // The state is untouched — ask for a snapshot and compare.
      a.send({ type: 'join', gameId: 'irrelevant' }, 0);
      await settle();
      expect(lastSnapshot(a.received)?.view.moveCount).toBe(before);
    });
  }

  it('rejects a binary frame', async () => {
    const { a } = await startedMatch();
    a.received.length = 0;

    a.socket.send(new Uint8Array([1, 2, 3]));
    await settle();

    expect(a.received[0]).toMatchObject({ type: 'error', code: 'malformed_intent' });
  });

  it('answers a heartbeat with nothing at all, rather than an error', async () => {
    const { a } = await startedMatch();
    a.received.length = 0;

    a.send({ type: 'heartbeat' }, 0);
    await settle();

    expect(a.received).toEqual([]);
  });

  it('answers join with a fresh snapshot for that seat', async () => {
    const { b } = await startedMatch();
    b.received.length = 0;

    b.send({ type: 'join', gameId: 'ignored' }, 0);
    await settle();

    expect(lastSnapshot(b.received)?.view.viewer).toBe('b');
  });
});

describe('hidden information never crosses the socket (spec §7.4, §10)', () => {
  it('sends each player only their own filtered view', async () => {
    const { a, b } = await startedMatch();

    const forA = lastSnapshot(a.received);
    const forB = lastSnapshot(b.received);

    expect(forA?.view.viewer).toBe('a');
    expect(forB?.view.viewer).toBe('b');
    // Each sees their own ten ships and none of the opponent's.
    expect(forA?.view.own.ships).toHaveLength(10);
    expect(forA?.view.opponent.sunkShips).toEqual([]);
    expect(forB?.view.own.ships).toHaveLength(10);
  });

  it('never transmits an un-hit opponent ship cell', async () => {
    // Verified by inspecting the wire traffic, exactly as spec §7.4 asks.
    const { a, b } = await startedMatch();
    const turn = lastSnapshot(a.received)?.view.turn;
    const mover = turn === 'a' ? a : b;

    mover.send(fire(ALWAYS_MISS), 1);
    await settle();

    // FLEET_B occupies odd rows; player A has hit none of it.
    const wireToA = JSON.stringify(a.received);
    for (const placement of FLEET_B) {
      expect(wireToA).not.toContain(JSON.stringify(placement.origin));
    }

    // The grid confirms it directly: every opponent cell is still unknown.
    const grid = lastSnapshot(a.received)?.view.opponent.grid ?? [];
    const revealed = grid.flat().filter((cell) => cell !== 'unknown' && cell !== 'miss');
    expect(revealed).toEqual([]);
  });

  it('gives the two players different payloads', async () => {
    const { a, b } = await startedMatch();

    expect(JSON.stringify(lastSnapshot(a.received))).not.toBe(
      JSON.stringify(lastSnapshot(b.received)),
    );
  });
});

describe('reconnection and restart', () => {
  it('gives a reconnecting player the authoritative state again', async () => {
    const { gameId, a, b } = await startedMatch();
    const turn = lastSnapshot(a.received)?.view.turn;
    const mover = turn === 'a' ? a : b;

    mover.send(fire(ALWAYS_MISS), 1);
    await settle();
    const expected = lastSnapshot(a.received)?.view;

    a.close();
    await settle();

    const resumed = await connect(gameId, 'player-a', 'a');
    await settle();

    expect(lastSnapshot(resumed.received)?.view).toEqual(expected);
  });

  it('survives the durable object being evicted between messages', async () => {
    const { gameId, a, b } = await startedMatch();
    const turn = lastSnapshot(a.received)?.view.turn;
    const mover = turn === 'a' ? a : b;

    mover.send(fire(ALWAYS_MISS), 1);
    await settle();
    const before = lastSnapshot(a.received)?.view;

    // Drop the in-memory instance; the next message must rebuild from storage.
    const id = env.GAME_ROOM.idFromName(gameId);
    await runInDurableObject(env.GAME_ROOM.get(id), (instance: Record<string, unknown>) => {
      instance.room = null;
      instance.session = null;
    });

    a.send({ type: 'join', gameId }, 0);
    await settle();

    expect(lastSnapshot(a.received)?.view).toEqual(before);
  });

  it('keeps replay protection across an eviction', async () => {
    // The dangerous case: if sequencing were lost with the in-memory instance, an old
    // intent could be applied a second time (spec §10).
    const { gameId, a, b } = await startedMatch();
    const turn = lastSnapshot(a.received)?.view.turn;
    const mover = turn === 'a' ? a : b;

    mover.send(fire(ALWAYS_MISS), 3);
    await settle();
    const moveCount = lastSnapshot(mover.received)?.view.moveCount;

    const id = env.GAME_ROOM.idFromName(gameId);
    await runInDurableObject(env.GAME_ROOM.get(id), (instance: Record<string, unknown>) => {
      instance.room = null;
      instance.session = null;
    });

    mover.send(fire(ALWAYS_MISS), 3);
    await settle();

    expect(lastSnapshot(mover.received)?.view.moveCount).toBe(moveCount);
  });

  it('persists the match so a later connection sees the same game', async () => {
    const { gameId, a, b } = await startedMatch();
    const turn = lastSnapshot(a.received)?.view.turn;
    (turn === 'a' ? a : b).send(fire(ALWAYS_MISS), 1);
    await settle();

    a.close();
    b.close();
    await settle();

    const rejoined = await connect(gameId, 'player-b', 'b');
    await settle();

    const view = lastSnapshot(rejoined.received)?.view;
    expect(view?.phase).toBe('playing');
    expect(view?.moveCount).toBe(1);
    expect(view?.own.ships).toHaveLength(10);
  });
});
