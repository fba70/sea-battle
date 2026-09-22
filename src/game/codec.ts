/**
 * JSON codec for the authoritative `GameState`.
 *
 * `GameState` is not JSON-native: `PlayerBoard.shots` and `PlayerBoard.revealedEmpty`
 * are `Set`s, which `JSON.stringify` turns into `{}`. Anything that persists or
 * transports authoritative state — the session layer (spec §5.1), `games.boards_json`
 * (spec §6) — must go through here rather than through `JSON.stringify` directly.
 *
 * SECURITY: an encoded state contains BOTH fleets. It is a server-side representation
 * only. It must never be sent to a client, cached anywhere a client can read, or
 * logged. The only representation a player may receive is `createPlayerView()`.
 *
 * Design notes:
 *
 * - **Fleets are encoded as placements, not as resolved `Ship`s.** Decoding runs them
 *   back through `validateFleet()`, so a decoded state cannot contain an illegal fleet
 *   even if the stored blob was tampered with, and `id`/`size`/`cells` are re-derived
 *   rather than trusted.
 * - **Cell sets are encoded as strictly ascending index arrays.** Canonical form means
 *   equal states encode to identical JSON, and duplicates or unsorted input are
 *   rejected as corruption rather than silently collapsed by `new Set`.
 * - **The format is versioned.** `decodeGameState` refuses a version it does not know
 *   instead of guessing at a layout change.
 * - This module deliberately hand-rolls its validation rather than importing Zod:
 *   `src/game` stays dependency-free (see `src/game/index.ts`). Zod guards the protocol
 *   boundary in `src/server/session/protocol.ts`, where untrusted client input arrives.
 */
import { CELL_COUNT, type CellIndex } from './coord';
import { isShipClass, validateFleet } from './placement';
import { err, ok, type Result } from './result';
import type { GameState, PlayerBoard } from './state';
import type {
  Coord,
  GamePhase,
  Orientation,
  PlayerSlot,
  ResultReason,
  Ship,
  ShipClass,
  ShipPlacement,
} from './types';

/** Bump when the encoded layout changes; `decodeGameState` rejects anything else. */
export const GAME_STATE_CODEC_VERSION = 1;

export interface EncodedPlacement {
  readonly shipClass: ShipClass;
  readonly origin: { readonly x: number; readonly y: number };
  readonly orientation: Orientation;
}

export interface EncodedBoard {
  /** The fleet as proposed placements; `cells`/`id`/`size` are re-derived on decode. */
  readonly ships: readonly EncodedPlacement[];
  /** Strictly ascending cell indices. */
  readonly shots: readonly CellIndex[];
  /** Strictly ascending cell indices, disjoint from `shots`. */
  readonly revealedEmpty: readonly CellIndex[];
}

export interface EncodedGameState {
  readonly v: number;
  readonly mode: 'classic';
  readonly phase: GamePhase;
  readonly boards: { readonly a: EncodedBoard; readonly b: EncodedBoard };
  readonly turn: PlayerSlot | null;
  readonly firstTurn: PlayerSlot;
  readonly winner: PlayerSlot | null;
  readonly resultReason: ResultReason | null;
  readonly moveCount: number;
}

export type CodecErrorCode =
  /** The payload was not a JSON object, or JSON.parse failed. */
  | 'malformed'
  /** A known field had the wrong type, or a value outside its domain. */
  | 'malformed_field'
  /** `v` is missing or names a layout this build cannot read. */
  | 'unsupported_version'
  /** The fleet failed the engine's own placement rules. */
  | 'illegal_fleet'
  /** Fields were individually well-formed but contradict each other. */
  | 'inconsistent_state';

export interface CodecError {
  readonly code: CodecErrorCode;
  readonly message: string;
  /** Dotted path to the offending field, when the fault is localised. */
  readonly path?: string;
}

const PHASES: readonly GamePhase[] = ['placement', 'playing', 'finished'];
const SLOTS: readonly PlayerSlot[] = ['a', 'b'];
const ORIENTATIONS: readonly Orientation[] = ['horizontal', 'vertical'];
const RESULT_REASONS: readonly ResultReason[] = ['sunk_all', 'forfeit', 'timeout', 'disconnect'];

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

function ascending(cells: ReadonlySet<CellIndex>): CellIndex[] {
  return [...cells].sort((left, right) => left - right);
}

function encodeBoard(board: PlayerBoard): EncodedBoard {
  return {
    ships: board.ships.map((ship) => ({
      shipClass: ship.shipClass,
      origin: { x: ship.origin.x, y: ship.origin.y },
      orientation: ship.orientation,
    })),
    shots: ascending(board.shots),
    revealedEmpty: ascending(board.revealedEmpty),
  };
}

/**
 * Encodes the complete authoritative state, losing nothing needed to resume a match.
 *
 * Deterministic: two semantically equal states produce identical JSON.
 */
export function encodeGameState(state: GameState): EncodedGameState {
  return {
    v: GAME_STATE_CODEC_VERSION,
    mode: state.mode,
    phase: state.phase,
    boards: { a: encodeBoard(state.boards.a), b: encodeBoard(state.boards.b) },
    turn: state.turn,
    firstTurn: state.firstTurn,
    winner: state.winner,
    resultReason: state.resultReason,
    moveCount: state.moveCount,
  };
}

export function serializeGameState(state: GameState): string {
  return JSON.stringify(encodeGameState(state));
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/**
 * Internal control flow only. Decoding is a deeply nested walk, and threading a
 * `Result` through every step buries the actual checks; the public API still
 * returns a `Result` and this never escapes the module.
 */
class CodecFailure extends Error {
  readonly detail: CodecError;

  constructor(detail: CodecError) {
    super(detail.message);
    this.name = 'CodecFailure';
    this.detail = detail;
  }
}

function fail(code: CodecErrorCode, message: string, path?: string): never {
  throw new CodecFailure({ code, message, ...(path === undefined ? {} : { path }) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    fail('malformed_field', `${path} must be an object`, path);
  }
  return value;
}

function asMember<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  const member = allowed.find((candidate) => candidate === value);
  if (member === undefined) {
    fail('malformed_field', `${path} must be one of: ${allowed.join(', ')}`, path);
  }
  return member;
}

function asNullableMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T | null {
  return value === null ? null : asMember(value, allowed, path);
}

function asInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail('malformed_field', `${path} must be a safe integer`, path);
  }
  return value;
}

function decodeCoord(value: unknown, path: string): Coord {
  const raw = asRecord(value, path);
  return { x: asInteger(raw.x, `${path}.x`), y: asInteger(raw.y, `${path}.y`) };
}

/**
 * Cell indices must arrive as a canonical, strictly ascending list. Out-of-range
 * values, duplicates and reordering all indicate a corrupted or hand-edited blob,
 * and `new Set` would swallow the last two silently.
 */
function decodeCellSet(value: unknown, path: string): Set<CellIndex> {
  if (!Array.isArray(value)) {
    fail('malformed_field', `${path} must be an array of cell indices`, path);
  }

  const cells = new Set<CellIndex>();
  let previous = -1;

  for (const [position, entry] of value.entries()) {
    const at = `${path}[${position}]`;
    const index = asInteger(entry, at);

    if (index < 0 || index >= CELL_COUNT) {
      fail('malformed_field', `${at} is not a board cell (expected 0..${CELL_COUNT - 1})`, at);
    }
    if (index <= previous) {
      fail('malformed_field', `${path} must be strictly ascending with no duplicates`, at);
    }

    previous = index;
    cells.add(index);
  }

  return cells;
}

function decodePlacement(value: unknown, path: string): ShipPlacement {
  const raw = asRecord(value, path);

  if (!isShipClass(raw.shipClass)) {
    fail('malformed_field', `${path}.shipClass is not a known ship class`, `${path}.shipClass`);
  }

  return {
    shipClass: raw.shipClass,
    origin: decodeCoord(raw.origin, `${path}.origin`),
    orientation: asMember(raw.orientation, ORIENTATIONS, `${path}.orientation`),
  };
}

/**
 * Re-validates the fleet with the engine rather than trusting the stored shape, so a
 * decoded board cannot hold overlapping, touching or off-board ships. A board is
 * either unplaced (empty) or holds a complete, legal fleet — `placeFleet` never
 * installs anything in between.
 */
function decodeFleet(value: unknown, path: string): readonly Ship[] {
  if (!Array.isArray(value)) {
    fail('malformed_field', `${path} must be an array of placements`, path);
  }

  if (value.length === 0) {
    return [];
  }

  const placements = value.map((entry, position) => decodePlacement(entry, `${path}[${position}]`));
  const validated = validateFleet(placements);

  if (!validated.ok) {
    fail('illegal_fleet', `${path}: ${validated.error.message}`, path);
  }

  return validated.value;
}

function decodeBoard(value: unknown, path: string): PlayerBoard {
  const raw = asRecord(value, path);
  const shots = decodeCellSet(raw.shots, `${path}.shots`);
  const revealedEmpty = decodeCellSet(raw.revealedEmpty, `${path}.revealedEmpty`);

  for (const index of revealedEmpty) {
    if (shots.has(index)) {
      fail(
        'inconsistent_state',
        `${path}: cell ${index} is both fired at and revealed-empty`,
        path,
      );
    }
  }

  return { ships: decodeFleet(raw.ships, `${path}.ships`), shots, revealedEmpty };
}

/**
 * Cross-field checks a per-field walk cannot make. Deliberately limited to invariants
 * that are true by definition of the phase, not to incidental arithmetic: `moveCount`
 * currently equals the total shot count, but a future auto-skip on timer expiry
 * (spec §4) may advance it without a shot, and a codec that rejected that would be a
 * landmine.
 */
function checkInvariants(state: GameState): void {
  const placed = state.boards.a.ships.length > 0 && state.boards.b.ships.length > 0;

  switch (state.phase) {
    case 'placement':
      if (state.turn !== null) {
        fail('inconsistent_state', 'turn must be null during the placement phase', 'turn');
      }
      if (state.winner !== null || state.resultReason !== null) {
        fail('inconsistent_state', 'an unfinished game cannot have a result', 'winner');
      }
      break;

    case 'playing':
      if (state.turn === null) {
        fail('inconsistent_state', 'a game in play must have a player to move', 'turn');
      }
      if (!placed) {
        fail('inconsistent_state', 'a game in play must have both fleets placed', 'boards');
      }
      if (state.winner !== null || state.resultReason !== null) {
        fail('inconsistent_state', 'an unfinished game cannot have a result', 'winner');
      }
      break;

    case 'finished':
      if (state.turn !== null) {
        fail('inconsistent_state', 'a finished game has no player to move', 'turn');
      }
      if (state.winner === null || state.resultReason === null) {
        fail('inconsistent_state', 'a finished game must record a winner and a reason', 'winner');
      }
      break;
  }

  if (state.moveCount < 0) {
    fail('malformed_field', 'moveCount must not be negative', 'moveCount');
  }
}

/**
 * Rebuilds a runtime `GameState` from an encoded payload, validating every field.
 *
 * Nothing is cast through: the fleet is re-run through `validateFleet`, cell sets are
 * range-checked and rebuilt as `Set`s, and phase-dependent invariants are asserted.
 */
export function decodeGameState(input: unknown): Result<GameState, CodecError> {
  try {
    const raw = asRecord(input, 'state');

    if (raw.v !== GAME_STATE_CODEC_VERSION) {
      fail(
        'unsupported_version',
        `Unsupported encoded state version: expected ${GAME_STATE_CODEC_VERSION}, got ${String(raw.v)}`,
        'v',
      );
    }

    if (raw.mode !== 'classic') {
      fail('malformed_field', 'Only the classic mode is supported', 'mode');
    }

    const boards = asRecord(raw.boards, 'state.boards');

    const state: GameState = {
      mode: 'classic',
      phase: asMember(raw.phase, PHASES, 'phase'),
      boards: {
        a: decodeBoard(boards.a, 'state.boards.a'),
        b: decodeBoard(boards.b, 'state.boards.b'),
      },
      turn: asNullableMember(raw.turn, SLOTS, 'turn'),
      firstTurn: asMember(raw.firstTurn, SLOTS, 'firstTurn'),
      winner: asNullableMember(raw.winner, SLOTS, 'winner'),
      resultReason: asNullableMember(raw.resultReason, RESULT_REASONS, 'resultReason'),
      moveCount: asInteger(raw.moveCount, 'moveCount'),
    };

    checkInvariants(state);

    return ok(state);
  } catch (error) {
    if (error instanceof CodecFailure) {
      return err(error.detail);
    }
    throw error;
  }
}

/** `decodeGameState` over a JSON string, turning a parse failure into the same `Result`. */
export function deserializeGameState(json: string): Result<GameState, CodecError> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return err({ code: 'malformed', message: 'Encoded state is not valid JSON' });
  }

  return decodeGameState(parsed);
}
