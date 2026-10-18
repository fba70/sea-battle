import { describe, expect, it } from 'vitest';

import {
  ABANDONED_GAME_AFTER_MS,
  createRoom,
  joinRoom,
  poolFor,
  quickMatch,
  sweepAbandonedGames,
  type LobbyPlayer,
  type LobbyStore,
  type QueuedPlayer,
} from './lobby';
import { generateRoomCode, normaliseRoomCode, ROOM_CODE_LENGTH } from './room-code';

const HOST: LobbyPlayer = { id: 'host', isAnonymous: false, rating: 1500 };
const GUEST: LobbyPlayer = { id: 'guest', isAnonymous: true, rating: 1500 };
const FRIEND: LobbyPlayer = { id: 'friend', isAnonymous: false, rating: 1600 };

/**
 * An in-memory lobby that behaves like the Postgres one: the seat claim and the pair
 * claim are the only two places that must be atomic, and both are modelled here as a
 * single indivisible step.
 */
function fakeStore(options: { collisions?: number } = {}) {
  let collisionsLeft = options.collisions ?? 0;
  let nextId = 0;
  const rooms = new Map<
    string,
    { gameId: string; playerAId: string | null; playerBId: string | null; status: string }
  >();
  const queue = new Map<string, { pool: string; rating: number; enqueuedAt: Date }>();
  const matches: { playerAId: string; playerBId: string; rated: boolean; id: string }[] = [];
  const sweeps: { olderThanMs: number; limit: number }[] = [];
  const resumes: { playerId: string; resumableForMs: number }[] = [];

  const store: LobbyStore = {
    createRoom: async ({ code, hostId }) => {
      if (collisionsLeft > 0) {
        collisionsLeft -= 1;
        return { collision: true };
      }
      nextId += 1;
      const gameId = `game-${nextId}`;
      rooms.set(code, { gameId, playerAId: hostId, playerBId: null, status: 'live' });
      return { gameId };
    },
    findRoomByCode: async (code) => rooms.get(code) ?? null,
    claimSecondSeat: async ({ gameId, playerId }) => {
      for (const room of rooms.values()) {
        if (room.gameId === gameId && room.playerBId === null && room.status === 'live') {
          room.playerBId = playerId;
          return { gameId };
        }
      }
      return null;
    },
    enqueue: async ({ playerId, pool, rating }) => {
      const existing = queue.get(playerId);
      queue.set(playerId, {
        pool,
        rating,
        // Re-queueing keeps the original place in line, as the SQL upsert does.
        enqueuedAt: existing?.enqueuedAt ?? new Date(Date.now() + queue.size),
      });
    },
    takePair: async ({ playerId, pool }): Promise<readonly QueuedPlayer[]> => {
      const mine = queue.get(playerId);
      const partner = [...queue.entries()]
        .filter(([id, row]) => id !== playerId && row.pool === pool)
        .sort((left, right) => left[1].enqueuedAt.getTime() - right[1].enqueuedAt.getTime())[0];

      if (!mine || mine.pool !== pool || !partner) {
        return [];
      }

      queue.delete(playerId);
      queue.delete(partner[0]);
      return [
        { userId: playerId, rating: mine.rating, enqueuedAt: mine.enqueuedAt },
        { userId: partner[0], rating: partner[1].rating, enqueuedAt: partner[1].enqueuedAt },
      ];
    },
    dequeue: async (playerId) => {
      queue.delete(playerId);
    },
    createMatch: async ({ playerAId, playerBId, rated }) => {
      nextId += 1;
      const id = `game-${nextId}`;
      matches.push({ playerAId, playerBId, rated, id });
      return { gameId: id };
    },
    findSeat: async () => null,
    findActiveMatch: async ({ playerId, resumableForMs }) => {
      resumes.push({ playerId, resumableForMs });
      const found = [...matches]
        .reverse()
        .find((m) => m.playerAId === playerId || m.playerBId === playerId);
      return found ? { gameId: found.id, seat: found.playerAId === playerId ? 'a' : 'b' } : null;
    },
    abortAbandonedGames: async (input) => {
      sweeps.push(input);
      return 0;
    },
  };

  return { store, rooms, queue, matches, sweeps, resumes };
}

describe('room codes', () => {
  it('avoids characters that are easy to misread or mistype', () => {
    const codes = Array.from({ length: 200 }, () => generateRoomCode()).join('');
    expect(codes).not.toMatch(/[0O1IL AEIOU]/);
    expect(codes).toMatch(/^[A-Z0-9]+$/);
  });

  it('is the advertised length and reasonably unique', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateRoomCode()));
    expect(generateRoomCode()).toHaveLength(ROOM_CODE_LENGTH);
    // 500 draws from ~191 million should essentially never collide.
    expect(codes.size).toBe(500);
  });

  it('forgives case, spaces and hyphens when a human types one', () => {
    expect(normaliseRoomCode(' bcdf23 ')).toBe('BCDF23');
    expect(normaliseRoomCode('bc-df-23')).toBe('BCDF23');
    expect(normaliseRoomCode('BCDF23')).toBe('BCDF23');
  });

  it('rejects anything that is not a code', () => {
    for (const bad of ['', '   ', 'ab', 'BCDF23!', 'much-too-long-to-be-a-code', '../../etc']) {
      expect(normaliseRoomCode(bad), bad).toBeNull();
    }
  });
});

describe('private rooms (spec §7.4)', () => {
  it('seats the creator in seat A and waits for a second player', async () => {
    const { store } = fakeStore();
    const room = await createRoom(store, HOST);

    expect(room.seat).toBe('a');
    expect(room.ready).toBe(false);
    expect(room.code).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('retries when a code is already taken', async () => {
    const { store } = fakeStore({ collisions: 2 });
    const room = await createRoom(store, HOST);
    expect(room.gameId).toBeTruthy();
  });

  it('creates rooms unrated, as spec §4 requires by default', async () => {
    const calls: boolean[] = [];
    const { store } = fakeStore();
    const spy: LobbyStore = {
      ...store,
      createRoom: async (input) => {
        calls.push(input.rated);
        return store.createRoom(input);
      },
    };

    await createRoom(spy, HOST);
    expect(calls).toEqual([false]);
  });

  it('rewrites no other rows — housekeeping is not a side effect of playing', async () => {
    // Opening a room used to sweep abandoned games along the way, which rewrote rows
    // nobody had asked about, during ordinary play and during every test that opened
    // a room. The sweep now belongs to the scheduled maintenance route alone.
    const { store, sweeps } = fakeStore();

    await createRoom(store, HOST);

    expect(sweeps).toEqual([]);
  });

  it('lets a friend join by code and takes seat B', async () => {
    const { store } = fakeStore();
    const room = await createRoom(store, HOST);

    const joined = await joinRoom(store, FRIEND, room.code);
    expect(joined.ok).toBe(true);
    expect(joined.ok && joined.seating).toMatchObject({
      gameId: room.gameId,
      seat: 'b',
      ready: true,
    });
  });

  it('accepts a code typed in lower case with spaces', async () => {
    const { store } = fakeStore();
    const room = await createRoom(store, HOST);

    const joined = await joinRoom(store, FRIEND, ` ${room.code.toLowerCase()} `);
    expect(joined.ok).toBe(true);
  });

  it('is idempotent for someone already seated', async () => {
    // Reloading the page or reopening the link must not be treated as a new join.
    const { store } = fakeStore();
    const room = await createRoom(store, HOST);
    await joinRoom(store, FRIEND, room.code);

    const hostAgain = await joinRoom(store, HOST, room.code);
    const friendAgain = await joinRoom(store, FRIEND, room.code);

    expect(hostAgain.ok && hostAgain.seating.seat).toBe('a');
    expect(hostAgain.ok && hostAgain.seating.ready).toBe(true);
    expect(friendAgain.ok && friendAgain.seating.seat).toBe('b');
  });

  it('refuses a third player', async () => {
    const { store } = fakeStore();
    const room = await createRoom(store, HOST);
    await joinRoom(store, FRIEND, room.code);

    const third = await joinRoom(store, GUEST, room.code);
    expect(third.ok).toBe(false);
    expect(!third.ok && third.reason).toBe('room_full');
  });

  it('never seats two people in seat B, even when they join at the same moment', async () => {
    const { store } = fakeStore();
    const room = await createRoom(store, HOST);

    const [first, second] = await Promise.all([
      joinRoom(store, FRIEND, room.code),
      joinRoom(store, GUEST, room.code),
    ]);

    const winners = [first, second].filter((result) => result.ok);
    expect(winners).toHaveLength(1);
  });

  const REFUSALS: readonly [string, string, string][] = [
    ['a malformed code', '!!', 'invalid_code'],
    ['an unknown code', 'BCDF23', 'room_not_found'],
  ];

  for (const [label, code, reason] of REFUSALS) {
    it(`refuses ${label}`, async () => {
      const { store } = fakeStore();
      const result = await joinRoom(store, FRIEND, code);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toBe(reason);
    });
  }

  it('seats a player whose own concurrent request won the race', async () => {
    // Two in-flight joins from one client: the loser used to be told the room was
    // full even though it had just been seated.
    const { store } = fakeStore();
    const room = await createRoom(store, HOST);

    const [first, second] = await Promise.all([
      joinRoom(store, FRIEND, room.code),
      joinRoom(store, FRIEND, room.code),
    ]);

    expect(first.ok, 'first request').toBe(true);
    expect(second.ok, 'second request').toBe(true);
    expect(first.ok && first.seating.seat).toBe('b');
    expect(second.ok && second.seating.seat).toBe('b');
  });

  it('refuses a room whose game already finished', async () => {
    const { store, rooms } = fakeStore();
    const room = await createRoom(store, HOST);
    for (const entry of rooms.values()) {
      entry.status = 'completed';
    }

    const result = await joinRoom(store, FRIEND, room.code);
    expect(!result.ok && result.reason).toBe('already_finished');
  });
});

describe('quick match (spec §7.4)', () => {
  it('queues the first player rather than matching them with themselves', async () => {
    const { store, matches } = fakeStore();
    const result = await quickMatch(store, HOST);

    expect(result.status).toBe('queued');
    expect(matches).toEqual([]);
  });

  it('pairs two waiting players and creates one game', async () => {
    const { store, matches } = fakeStore();
    await quickMatch(store, HOST);
    const second = await quickMatch(store, FRIEND);

    expect(second.status).toBe('matched');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ playerAId: HOST.id, playerBId: FRIEND.id });
  });

  it('seats whoever waited longest in seat A', async () => {
    const { store, matches } = fakeStore();
    await quickMatch(store, FRIEND);
    await quickMatch(store, HOST);

    expect(matches[0]?.playerAId).toBe(FRIEND.id);
  });

  it('empties the queue once a pair is taken', async () => {
    const { store, queue } = fakeStore();
    await quickMatch(store, HOST);
    await quickMatch(store, FRIEND);

    expect(queue.size).toBe(0);
  });

  it('never pairs one waiting player into two games', async () => {
    // Spec §7.4's atomicity requirement, from the matcher's side: three players
    // polling at once must produce exactly one game and leave one waiting.
    const { store, matches } = fakeStore();
    const third: LobbyPlayer = { id: 'third', isAnonymous: false, rating: 1500 };

    await Promise.all([
      quickMatch(store, HOST),
      quickMatch(store, FRIEND),
      quickMatch(store, third),
    ]);

    expect(matches).toHaveLength(1);
    const seated = new Set([matches[0]?.playerAId, matches[0]?.playerBId]);
    expect(seated.size).toBe(2);
  });

  it('tells the paired player about the game on their next poll', async () => {
    // Pairing removes both players from the queue, but only the matcher learns the
    // result from its own call — the other is still polling and must be told.
    const { store, matches } = fakeStore();
    await quickMatch(store, HOST);
    const matcher = await quickMatch(store, FRIEND);
    expect(matcher.status).toBe('matched');

    const waiting = await quickMatch(store, HOST);
    expect(waiting.status).toBe('matched');
    expect(waiting.status === 'matched' && waiting.seating.gameId).toBe(matches[0]?.id);
    // And it must not have created a second game for them.
    expect(matches).toHaveLength(1);
  });

  it('does not re-queue a player who is already in a game', async () => {
    const { store, queue, matches } = fakeStore();
    await quickMatch(store, HOST);
    await quickMatch(store, FRIEND);

    await quickMatch(store, HOST);
    await quickMatch(store, FRIEND);

    expect(queue.size).toBe(0);
    expect(matches).toHaveLength(1);
  });

  it('keeps polling harmless — a lone player stays queued, not dropped', async () => {
    const { store, queue } = fakeStore();
    await quickMatch(store, HOST);
    await quickMatch(store, HOST);
    await quickMatch(store, HOST);

    expect(queue.has(HOST.id)).toBe(true);
    expect(queue.size).toBe(1);
  });
});

describe('guests and rating (spec §4, OQ-6)', () => {
  it('puts guests in their own unrated pool', () => {
    expect(poolFor(GUEST)).toBe('unrated');
    expect(poolFor(HOST)).toBe('rated');
  });

  it('never matches a guest with a registered player', async () => {
    const { store, matches } = fakeStore();
    await quickMatch(store, GUEST);
    const registered = await quickMatch(store, HOST);

    // Different pools: neither can see the other, so both simply wait.
    expect(registered.status).toBe('queued');
    expect(matches).toEqual([]);
  });

  it('creates a guest match unrated', async () => {
    const { store, matches } = fakeStore();
    const otherGuest: LobbyPlayer = { id: 'guest-2', isAnonymous: true, rating: 1500 };

    await quickMatch(store, GUEST);
    await quickMatch(store, otherGuest);

    expect(matches[0]?.rated).toBe(false);
  });

  it('creates a registered-vs-registered match rated', async () => {
    const { store, matches } = fakeStore();
    await quickMatch(store, HOST);
    await quickMatch(store, FRIEND);

    expect(matches[0]?.rated).toBe(true);
  });
});

describe('starting another quick match', () => {
  it('only resumes a game recent enough to still be running', async () => {
    /**
     * The bug this guards: a game row stays `live` until the realtime layer reports
     * its result. When that report never landed, every attempt to start a new match
     * handed the player their dead game back — which is what "the New match button
     * does nothing" actually was.
     */
    const { store, resumes } = fakeStore();

    await quickMatch(store, { id: 'player-1', isAnonymous: false, rating: 1500 });

    expect(resumes).toHaveLength(1);
    expect(resumes[0]?.resumableForMs).toBe(ABANDONED_GAME_AFTER_MS);
  });

  it('lets both players queue again independently after a match', async () => {
    // Each player's next match is their own decision; neither waits for the other.
    const { store } = fakeStore();
    const one = { id: 'player-1', isAnonymous: false, rating: 1500 };
    const two = { id: 'player-2', isAnonymous: false, rating: 1500 };

    expect((await quickMatch(store, one)).status).toBe('queued');
    const paired = await quickMatch(store, two);

    expect(paired.status).toBe('matched');
  });
});

describe('the abandoned-game sweep', () => {
  it('closes games older than the window, in bounded batches', async () => {
    const { store, sweeps } = fakeStore();

    await sweepAbandonedGames(store);

    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.olderThanMs).toBe(ABANDONED_GAME_AFTER_MS);
    expect(sweeps[0]?.limit).toBeGreaterThan(0);
  });

  it('never lets a housekeeping failure surface to the caller', async () => {
    const { store } = fakeStore();
    const failing = {
      ...store,
      abortAbandonedGames: async () => {
        throw new Error('database unavailable');
      },
    };

    await expect(sweepAbandonedGames(failing)).resolves.toBe(0);
  });
});
