import { describe, expect, it } from 'vitest';

import { encodeGameState } from '@/game/codec';
import { fire } from '@/game/fire';
import { FLEET_A, FLEET_B } from '@/game/testing/fixtures';
import { fireAll, startedGame } from '@/game/testing/harness';
import type { GameState } from '@/game/state';
import type { RatingOutcome } from '@/lib/rating/process';
import {
  RESULT_SIGNATURE_HEADER,
  signResultReport,
  verifyResultReport,
} from '@/server/result-report';

import {
  completeLiveGame,
  createLiveGame,
  type CompleteLiveGameInput,
  type CreateLiveGameInput,
  type LiveGameRecord,
  type LiveGameStore,
} from './live-game';

const GAME_ID = 'game-1';
const PLAYER_A = 'user-a';
const PLAYER_B = 'user-b';
const SECRET = 'a-sufficiently-long-shared-ticket-secret-value';

/** A finished game: player A sinks B's whole fleet, so the turn never passes. */
function finishedGame(): GameState {
  const started = startedGame(FLEET_A, FLEET_B);
  const cells = started.boards.b.ships.flatMap((ship) => [...ship.cells]);
  const state = fireAll(started, 'a', cells);
  expect(state.phase).toBe('finished');
  return state;
}

function liveRecord(overrides: Partial<LiveGameRecord> = {}): LiveGameRecord {
  return { id: GAME_ID, playerAId: PLAYER_A, playerBId: PLAYER_B, status: 'live', ...overrides };
}

function fakeStore(options: { game?: LiveGameRecord | null; completed?: boolean } = {}) {
  const created: CreateLiveGameInput[] = [];
  const completions: CompleteLiveGameInput[] = [];
  const store: LiveGameStore = {
    create: async (input) => {
      created.push(input);
      return { id: GAME_ID };
    },
    load: async () => (options.game === undefined ? liveRecord() : options.game),
    complete: async (input) => {
      completions.push(input);
      return { completed: options.completed ?? true };
    },
  };
  return { store, created, completions };
}

function fakeRating(status: RatingOutcome['status'] = 'applied') {
  const calls: string[] = [];
  const rate = async (gameId: string): Promise<RatingOutcome> => {
    calls.push(gameId);
    return status === 'applied'
      ? { status: 'applied', gameId, deltaA: 12, deltaB: -12 }
      : { status: 'skipped', gameId, reason: 'not_rated' };
  };
  return { rate, calls };
}

describe('createLiveGame', () => {
  it('creates the row a live game is played against', async () => {
    const { store, created } = fakeStore();
    const result = await createLiveGame(store, {
      mode: 'classic',
      type: 'quickmatch',
      rated: true,
      playerAId: PLAYER_A,
      playerBId: PLAYER_B,
    });

    expect(result.id).toBe(GAME_ID);
    expect(created[0]).toMatchObject({ type: 'quickmatch', rated: true });
  });

  it('refuses a game where both seats are the same player', async () => {
    const { store } = fakeStore();
    await expect(
      createLiveGame(store, {
        mode: 'classic',
        type: 'quickmatch',
        rated: false,
        playerAId: PLAYER_A,
        playerBId: PLAYER_A,
      }),
    ).rejects.toThrow();
  });

  it('refuses a rated private game, which spec §4 does not allow by default', async () => {
    const { store } = fakeStore();
    await expect(
      createLiveGame(store, {
        mode: 'classic',
        type: 'private',
        rated: true,
        playerAId: PLAYER_A,
        playerBId: PLAYER_B,
      }),
    ).rejects.toThrow();
  });
});

describe('completeLiveGame derives the result from the board', () => {
  it('completes the game and runs rating', async () => {
    const { store, completions } = fakeStore();
    const rating = fakeRating();

    const outcome = await completeLiveGame(store, rating.rate, {
      gameId: GAME_ID,
      state: encodeGameState(finishedGame()),
    });

    expect(outcome.status).toBe('completed');
    expect(completions[0]).toMatchObject({
      gameId: GAME_ID,
      winnerSeat: 'a',
      // Resolved from the row's own seat column, so the Block 2 winner CHECK holds.
      winnerId: PLAYER_A,
      resultReason: 'sunk_all',
      moveCount: 20,
    });
    expect(rating.calls).toEqual([GAME_ID]);
  });

  it('takes the winner from the decoded state, not from the caller', async () => {
    // Nothing in the report says who won — it is read off the finished board.
    const { store, completions } = fakeStore();
    const started = startedGame(FLEET_A, FLEET_B);
    const cells = started.boards.a.ships.flatMap((ship) => [...ship.cells]);
    const bWins = fireAll({ ...started, turn: 'b' }, 'b', cells);

    await completeLiveGame(store, fakeRating().rate, {
      gameId: GAME_ID,
      state: encodeGameState(bWins),
    });

    expect(completions[0]?.winnerSeat).toBe('b');
    expect(completions[0]?.winnerId).toBe(PLAYER_B);
  });

  it('stores the encoded final state for history', async () => {
    const { store, completions } = fakeStore();
    const state = finishedGame();

    await completeLiveGame(store, fakeRating().rate, {
      gameId: GAME_ID,
      state: encodeGameState(state),
    });

    expect(completions[0]?.state).toEqual(encodeGameState(state));
  });

  const REJECTED: readonly [string, () => unknown, string][] = [
    ['a game that does not exist', () => encodeGameState(finishedGame()), 'game_not_found'],
    ['a state the codec refuses', () => ({ v: 1, phase: 'lobby' }), 'state_invalid'],
    ['a game still in play', () => encodeGameState(startedGame(FLEET_A, FLEET_B)), 'not_finished'],
  ];

  for (const [label, build, reason] of REJECTED) {
    it(`rejects ${label}`, async () => {
      const { store, completions } = fakeStore(reason === 'game_not_found' ? { game: null } : {});

      const outcome = await completeLiveGame(store, fakeRating().rate, {
        gameId: GAME_ID,
        state: build() as ReturnType<typeof encodeGameState>,
      });

      expect(outcome.status).toBe('rejected');
      expect(outcome.status === 'rejected' && outcome.reason).toBe(reason);
      // Nothing is written when the report is refused.
      expect(completions).toEqual([]);
    });
  }

  it('rejects a winner the row does not seat', async () => {
    const { store, completions } = fakeStore({ game: liveRecord({ playerAId: null }) });

    const outcome = await completeLiveGame(store, fakeRating().rate, {
      gameId: GAME_ID,
      state: encodeGameState(finishedGame()),
    });

    expect(outcome.status === 'rejected' && outcome.reason).toBe('seat_not_seated');
    expect(completions).toEqual([]);
  });

  it('rejects a tampered fleet in the reported state', async () => {
    // The codec re-validates both boards, so a report cannot write an illegal game.
    const encoded = encodeGameState(finishedGame());
    const ships = encoded.boards.a.ships.map((ship, index) =>
      index === 1 ? { ...ship, origin: { x: 0, y: 0 } } : ship,
    );

    const { store } = fakeStore();
    const outcome = await completeLiveGame(store, fakeRating().rate, {
      gameId: GAME_ID,
      state: { ...encoded, boards: { ...encoded.boards, a: { ...encoded.boards.a, ships } } },
    });

    expect(outcome.status === 'rejected' && outcome.reason).toBe('state_invalid');
  });
});

describe('a retried report is safe', () => {
  it('reports already_completed without writing twice', async () => {
    const { store, completions } = fakeStore({ completed: false });
    const rating = fakeRating('skipped');

    const outcome = await completeLiveGame(store, rating.rate, {
      gameId: GAME_ID,
      state: encodeGameState(finishedGame()),
    });

    expect(outcome.status).toBe('already_completed');
    // The compare-and-set was attempted and matched nothing — that is the guard.
    expect(completions).toHaveLength(1);
  });

  it('still runs rating when the row was already completed', async () => {
    // A report can be retried after the row was completed but before ratings were
    // applied; the Block 4 processor is the thing that decides whether to act.
    const { store } = fakeStore({ completed: false });
    const rating = fakeRating();

    await completeLiveGame(store, rating.rate, {
      gameId: GAME_ID,
      state: encodeGameState(finishedGame()),
    });

    expect(rating.calls).toEqual([GAME_ID]);
  });

  it('is deterministic across repeated reports', async () => {
    const state = encodeGameState(finishedGame());
    const first = await completeLiveGame(fakeStore().store, fakeRating().rate, {
      gameId: GAME_ID,
      state,
    });
    const second = await completeLiveGame(fakeStore().store, fakeRating().rate, {
      gameId: GAME_ID,
      state,
    });

    expect(first).toEqual(second);
  });
});

describe('the result report is authenticated', () => {
  it('round-trips a signed report', async () => {
    const report = { gameId: GAME_ID, state: encodeGameState(finishedGame()) };
    const { body, signature } = await signResultReport(report, SECRET);

    const verified = await verifyResultReport(body, signature, SECRET);
    expect(verified.ok).toBe(true);
    expect(verified.ok && verified.report.gameId).toBe(GAME_ID);
  });

  it('rejects a report signed with the wrong secret', async () => {
    const { body, signature } = await signResultReport(
      { gameId: GAME_ID, state: encodeGameState(finishedGame()) },
      'the-wrong-secret-entirely-and-long-enough',
    );

    const verified = await verifyResultReport(body, signature, SECRET);
    expect(verified.ok).toBe(false);
  });

  it('rejects a body that was altered after signing', async () => {
    const { body, signature } = await signResultReport(
      { gameId: GAME_ID, state: encodeGameState(finishedGame()) },
      SECRET,
    );

    const tampered = body.replace(GAME_ID, 'someone-elses-game');
    expect((await verifyResultReport(tampered, signature, SECRET)).ok).toBe(false);
  });

  it('rejects a missing signature', async () => {
    const { body } = await signResultReport(
      { gameId: GAME_ID, state: encodeGameState(finishedGame()) },
      SECRET,
    );

    expect((await verifyResultReport(body, null, SECRET)).ok).toBe(false);
    expect((await verifyResultReport(body, '', SECRET)).ok).toBe(false);
  });

  it('names the header the signature travels in', () => {
    expect(RESULT_SIGNATURE_HEADER).toBe('x-seaduel-signature');
  });
});

describe('a game still in play is never completed', () => {
  it('refuses a state one shot short of finished', async () => {
    const started = startedGame(FLEET_A, FLEET_B);
    const cells = started.boards.b.ships.flatMap((ship) => [...ship.cells]);
    const almost = fireAll(started, 'a', cells.slice(0, -1));
    expect(almost.phase).toBe('playing');

    const { store, completions } = fakeStore();
    const outcome = await completeLiveGame(store, fakeRating().rate, {
      gameId: GAME_ID,
      state: encodeGameState(almost),
    });

    expect(outcome.status === 'rejected' && outcome.reason).toBe('not_finished');
    expect(completions).toEqual([]);

    // And the very next shot does finish it.
    const last = fire(almost, 'a', cells[cells.length - 1] as { x: number; y: number });
    expect(last.ok && last.value.state.phase).toBe('finished');
  });
});
