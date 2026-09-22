import { describe, expect, it } from 'vitest';

import {
  decodeGameState,
  deserializeGameState,
  encodeGameState,
  serializeGameState,
  GAME_STATE_CODEC_VERSION,
  type EncodedGameState,
} from './codec';
import { toIndex } from './coord';
import { fire } from './fire';
import { createGame, type GameState } from './state';
import { FLEET_A, FLEET_B } from './testing/fixtures';
import { fireAll, fireAllForcingTurn, startedGame } from './testing/harness';
import type { Coord } from './types';

/** A miss for both fixture fleets: columns I/J are always empty. */
const ALWAYS_MISS: Coord = { x: 9, y: 9 };

function shipCellsOf(state: GameState, slot: 'a' | 'b'): Coord[] {
  return state.boards[slot].ships.flatMap((ship) => [...ship.cells]);
}

/** Placement phase, nothing placed. */
function emptyGame(): GameState {
  return createGame({ firstTurn: 'b' });
}

/** Placement phase with one fleet in — the asymmetric case. */
function halfPlacedGame(): GameState {
  const state = createGame();
  const placed = shipCellsOf(startedGame(), 'a');
  expect(placed.length).toBeGreaterThan(0);
  return { ...state, boards: { ...state.boards, a: startedGame().boards.a } };
}

/**
 * Both fleets placed, a handful of shots resolved, at least one ship sunk so
 * `revealedEmpty` is populated and the two sets differ.
 */
function partiallyPlayedGame(): GameState {
  // The 4-cell battleship of FLEET_B sits at row 1 (y = 1), columns A-D.
  let state = fireAll(startedGame(FLEET_A, FLEET_B), 'a', [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    ALWAYS_MISS,
  ]);
  state = fireAll(state, 'b', [{ x: 8, y: 8 }]);
  return state;
}

/** A won game: every cell of B's fleet hit, so the turn never leaves A. */
function finishedGame(): GameState {
  const started = startedGame(FLEET_A, FLEET_B);
  const state = fireAll(started, 'a', shipCellsOf(started, 'b'));
  expect(state.phase).toBe('finished');
  expect(state.winner).toBe('a');
  return state;
}

const SCENARIOS: readonly (readonly [string, () => GameState])[] = [
  ['a new game with nothing placed', emptyGame],
  ['a game with only one fleet placed', halfPlacedGame],
  ['a game in progress', partiallyPlayedGame],
  ['a finished game', finishedGame],
];

describe('encodeGameState', () => {
  it('produces a payload that survives JSON.stringify without losing the cell sets', () => {
    const state = partiallyPlayedGame();

    // The motivating defect: the raw state's Sets stringify to `{}`.
    const naive = JSON.parse(JSON.stringify(state)) as GameState;
    expect(naive.boards.b.shots).toEqual({});

    const encoded = JSON.parse(serializeGameState(state)) as EncodedGameState;
    expect(encoded.boards.b.shots.length).toBe(state.boards.b.shots.size);
    expect(encoded.boards.b.revealedEmpty.length).toBe(state.boards.b.revealedEmpty.size);
  });

  it('stamps the format version', () => {
    expect(encodeGameState(emptyGame()).v).toBe(GAME_STATE_CODEC_VERSION);
  });

  it('is canonical: equal states encode to identical JSON', () => {
    // The same two misses, resolved in opposite orders, so the underlying Set
    // iteration order differs. Sorting on encode must make the payloads identical.
    // (Both are misses, so the harness has to hand the turn back between them.)
    const ascending = fireAllForcingTurn(startedGame(), 'a', [
      { x: 8, y: 0 },
      { x: 8, y: 2 },
    ]);
    const descending = fireAllForcingTurn(startedGame(), 'a', [
      { x: 8, y: 2 },
      { x: 8, y: 0 },
    ]);

    expect(serializeGameState(ascending)).toBe(serializeGameState(descending));
  });

  it('does not mutate the state it encodes', () => {
    const state = partiallyPlayedGame();
    const before = serializeGameState(state);
    encodeGameState(state);
    expect(serializeGameState(state)).toBe(before);
  });
});

describe('round trip', () => {
  for (const [label, build] of SCENARIOS) {
    it(`restores ${label} to a semantically equal state`, () => {
      const original = build();
      const decoded = deserializeGameState(serializeGameState(original));

      expect(decoded.ok).toBe(true);
      if (!decoded.ok) {
        return;
      }

      // Vitest's deep equality compares Set contents, so this covers shots and
      // revealedEmpty as well as the scalar fields and the resolved fleets.
      expect(decoded.value).toEqual(original);
      expect(serializeGameState(decoded.value)).toBe(serializeGameState(original));
    });
  }

  it('restores shots and revealedEmpty as real Sets, not arrays or objects', () => {
    const original = partiallyPlayedGame();
    const decoded = deserializeGameState(serializeGameState(original));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }

    for (const slot of ['a', 'b'] as const) {
      const board = decoded.value.boards[slot];
      expect(board.shots).toBeInstanceOf(Set);
      expect(board.revealedEmpty).toBeInstanceOf(Set);
      expect([...board.shots].sort()).toEqual([...original.boards[slot].shots].sort());
      expect([...board.revealedEmpty].sort()).toEqual(
        [...original.boards[slot].revealedEmpty].sort(),
      );
    }

    // The sunk battleship's buffer really is populated, so this is not vacuous.
    expect(decoded.value.boards.b.revealedEmpty.size).toBeGreaterThan(0);
  });

  it('restores resolved ships with their ids, sizes and cells re-derived', () => {
    const original = partiallyPlayedGame();
    const decoded = deserializeGameState(serializeGameState(original));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }

    expect(decoded.value.boards.a.ships).toEqual(original.boards.a.ships);
    expect(decoded.value.boards.a.ships.map((ship) => ship.id)).toEqual(
      original.boards.a.ships.map((ship) => ship.id),
    );
  });

  it('produces a state the engine can keep playing', () => {
    const original = partiallyPlayedGame();
    const decoded = deserializeGameState(serializeGameState(original));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }

    const target: Coord = { x: 9, y: 0 };
    const fromOriginal = fire(original, original.turn ?? 'a', target);
    const fromDecoded = fire(decoded.value, decoded.value.turn ?? 'a', target);

    expect(fromDecoded.ok).toBe(true);
    expect(fromOriginal.ok).toBe(true);
    if (!fromOriginal.ok || !fromDecoded.ok) {
      return;
    }

    expect(fromDecoded.value.event).toEqual(fromOriginal.value.event);
    expect(serializeGameState(fromDecoded.value.state)).toBe(
      serializeGameState(fromOriginal.value.state),
    );
  });

  it('rejects a shot the original would have rejected — the sets really carry over', () => {
    const original = partiallyPlayedGame();
    const decoded = deserializeGameState(serializeGameState(original));

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      return;
    }

    const alreadyFired: Coord = { x: 0, y: 1 };
    const result = fire(decoded.value, decoded.value.turn ?? 'a', alreadyFired);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('already_fired');
    }
  });
});

describe('decodeGameState rejects corrupt payloads', () => {
  function valid(): EncodedGameState {
    return encodeGameState(partiallyPlayedGame());
  }

  /** Structural edits to an otherwise valid payload. */
  const CASES: readonly (readonly [string, () => unknown, string])[] = [
    ['a non-object', () => 42, 'malformed_field'],
    ['null', () => null, 'malformed_field'],
    ['an array', () => [], 'malformed_field'],
    ['a missing version', () => ({ ...valid(), v: undefined }), 'unsupported_version'],
    ['a future version', () => ({ ...valid(), v: 999 }), 'unsupported_version'],
    ['an unknown mode', () => ({ ...valid(), mode: 'salvo' }), 'malformed_field'],
    ['an unknown phase', () => ({ ...valid(), phase: 'lobby' }), 'malformed_field'],
    ['a bogus turn', () => ({ ...valid(), turn: 'c' }), 'malformed_field'],
    ['a bogus firstTurn', () => ({ ...valid(), firstTurn: null }), 'malformed_field'],
    ['a bogus result reason', () => ({ ...valid(), resultReason: 'bored' }), 'malformed_field'],
    ['a fractional moveCount', () => ({ ...valid(), moveCount: 1.5 }), 'malformed_field'],
    ['a negative moveCount', () => ({ ...valid(), moveCount: -1 }), 'malformed_field'],
    ['a NaN moveCount', () => ({ ...valid(), moveCount: Number.NaN }), 'malformed_field'],
    ['missing boards', () => ({ ...valid(), boards: undefined }), 'malformed_field'],
    [
      'a board that is not an object',
      () => ({ ...valid(), boards: { a: 'nope', b: valid().boards.b } }),
      'malformed_field',
    ],
    [
      'shots that are not an array',
      () => {
        const base = valid();
        return { ...base, boards: { ...base.boards, a: { ...base.boards.a, shots: 7 } } };
      },
      'malformed_field',
    ],
    [
      'a shot index off the board',
      () => {
        const base = valid();
        return { ...base, boards: { ...base.boards, a: { ...base.boards.a, shots: [100] } } };
      },
      'malformed_field',
    ],
    [
      'a negative shot index',
      () => {
        const base = valid();
        return { ...base, boards: { ...base.boards, a: { ...base.boards.a, shots: [-1] } } };
      },
      'malformed_field',
    ],
    [
      'duplicate shot indices',
      () => {
        const base = valid();
        return { ...base, boards: { ...base.boards, a: { ...base.boards.a, shots: [5, 5] } } };
      },
      'malformed_field',
    ],
    [
      'unsorted shot indices',
      () => {
        const base = valid();
        return { ...base, boards: { ...base.boards, a: { ...base.boards.a, shots: [9, 2] } } };
      },
      'malformed_field',
    ],
    [
      'a cell that is both fired at and revealed-empty',
      () => {
        const base = valid();
        const shots = base.boards.b.shots;
        return {
          ...base,
          boards: {
            ...base.boards,
            b: { ...base.boards.b, revealedEmpty: [...shots].slice(0, 1) },
          },
        };
      },
      'inconsistent_state',
    ],
    [
      'an unknown ship class',
      () => {
        const base = valid();
        const ships = [{ ...base.boards.a.ships[0], shipClass: 'dreadnought' }];
        return { ...base, boards: { ...base.boards, a: { ...base.boards.a, ships } } };
      },
      'malformed_field',
    ],
    [
      'a ship origin that is not a coordinate',
      () => {
        const base = valid();
        const ships = [{ ...base.boards.a.ships[0], origin: { x: 'A', y: 1 } }];
        return { ...base, boards: { ...base.boards, a: { ...base.boards.a, ships } } };
      },
      'malformed_field',
    ],
    [
      'a diagonal orientation',
      () => {
        const base = valid();
        const ships = base.boards.a.ships.map((ship, index) =>
          index === 0 ? { ...ship, orientation: 'diagonal' } : ship,
        );
        return { ...base, boards: { ...base.boards, a: { ...base.boards.a, ships } } };
      },
      'malformed_field',
    ],
  ];

  for (const [label, build, expectedCode] of CASES) {
    it(`rejects ${label}`, () => {
      const result = decodeGameState(build());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(expectedCode);
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  }

  it('rejects a tampered fleet that breaks the no-touching rule', () => {
    const base = encodeGameState(partiallyPlayedGame());
    // Move the first cruiser on top of the battleship's buffer ring.
    const ships = base.boards.a.ships.map((ship, index) =>
      index === 1 ? { ...ship, origin: { x: 0, y: 1 } } : ship,
    );
    const result = decodeGameState({
      ...base,
      boards: { ...base.boards, a: { ...base.boards.a, ships } },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('illegal_fleet');
      expect(result.error.path).toBe('state.boards.a.ships');
    }
  });

  it('rejects a fleet with the wrong composition', () => {
    const base = encodeGameState(partiallyPlayedGame());
    const ships = base.boards.a.ships.slice(0, 9);
    const result = decodeGameState({
      ...base,
      boards: { ...base.boards, a: { ...base.boards.a, ships } },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('illegal_fleet');
    }
  });

  it('rejects a game in play with no player to move', () => {
    const result = decodeGameState({ ...encodeGameState(partiallyPlayedGame()), turn: null });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('inconsistent_state');
      expect(result.error.path).toBe('turn');
    }
  });

  it('rejects a game in play whose fleets are not placed', () => {
    const base = encodeGameState(partiallyPlayedGame());
    const result = decodeGameState({
      ...base,
      boards: { ...base.boards, b: { ...base.boards.b, ships: [] } },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('inconsistent_state');
    }
  });

  it('rejects a finished game with no winner', () => {
    const result = decodeGameState({ ...encodeGameState(finishedGame()), winner: null });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('inconsistent_state');
    }
  });

  it('rejects a placement-phase game that already has a winner', () => {
    const result = decodeGameState({
      ...encodeGameState(emptyGame()),
      winner: 'a',
      resultReason: 'forfeit',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('inconsistent_state');
    }
  });

  it('carries a field path on localised failures', () => {
    const result = decodeGameState({ ...encodeGameState(emptyGame()), phase: 'lobby' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.path).toBe('phase');
    }
  });
});

describe('deserializeGameState', () => {
  it('reports invalid JSON rather than throwing', () => {
    const result = deserializeGameState('{ not json');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('malformed');
    }
  });

  it('reports a valid-JSON payload that is not a state', () => {
    const result = deserializeGameState('"hello"');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('malformed_field');
    }
  });
});

describe('index arithmetic', () => {
  it('encodes shots at the indices the engine uses', () => {
    const state = fireAll(startedGame(), 'a', [{ x: 9, y: 3 }]);
    const encoded = encodeGameState(state);

    expect(encoded.boards.b.shots).toEqual([toIndex({ x: 9, y: 3 })]);
  });
});
