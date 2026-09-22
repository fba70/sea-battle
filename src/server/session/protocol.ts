/**
 * The client ⇄ session protocol from spec §9, as a transport-independent contract.
 *
 * This module defines *shapes*, not rules. The split is deliberate and load-bearing:
 *
 * - **Schema validation** (here) decides whether a message is structurally a message:
 *   right discriminator, right field types, no unknown keys, no absurd payload sizes.
 * - **The rules engine** (`src/game`) decides whether a structurally valid intent is
 *   *legal* in the current match: bounds, turn ownership, duplicate shots, fleet
 *   composition, no-touching. None of that is restated here.
 *
 * So the schemas deliberately do NOT range-check coordinates against the board, and do
 * NOT check fleet composition: `fire()` and `validateFleet()` already own those, and
 * re-implementing them would create a second ruleset to keep in sync — and would
 * replace the engine's precise `out_of_bounds` / `wrong_fleet_composition` codes with
 * an anonymous `malformed_intent`.
 *
 * Nothing here knows about WebSockets, HTTP, Redis, Ably, Durable Objects or React.
 */
import { z } from 'zod';

import { FLEET_SHIP_COUNT } from '@/game/constants';
import type { FireError } from '@/game/fire';
import type { PlaceFleetError } from '@/game/state';
import type { Coord, PlayerSlot, ResultReason, ShipClass, ShotOutcome } from '@/game/types';
import type { PlayerView } from '@/game/view';

// ---------------------------------------------------------------------------
// Payload sanity bounds
// ---------------------------------------------------------------------------

/**
 * Upper bound on cells in one `fire` intent. Salvo's N is the firing player's
 * surviving ship count (spec §4), which can never exceed the fleet size, so this is
 * the largest legitimate salvo in any mode. The *exact* size for the current mode and
 * state is the session's call, not the schema's — see `wrong_salvo_size`.
 */
export const MAX_CELLS_PER_FIRE = FLEET_SHIP_COUNT;

/**
 * Upper bound on placements in one `place_fleet` intent. Purely a denial-of-service
 * guard so a client cannot make the server validate a million ships; anything between
 * the real fleet size and this bound is rejected by `validateFleet` with the precise
 * `wrong_fleet_composition` code.
 */
export const MAX_PLACEMENTS_PER_INTENT = 64;

/** Upper bound on an opaque identifier (game id, emoji token). */
const MAX_IDENTIFIER_LENGTH = 128;

// ---------------------------------------------------------------------------
// Client → server intents (spec §9)
// ---------------------------------------------------------------------------

/**
 * Structure only: a pair of safe integers. Whether the pair is on the board is
 * `fire()`'s and `validateFleet()`'s decision, which is why an off-board coordinate
 * comes back as `out_of_bounds` rather than `malformed_intent`.
 */
export const coordSchema = z.strictObject({ x: z.int(), y: z.int() });

export const shipPlacementSchema = z.strictObject({
  // Mirrors ShipClass in src/game/types.ts; protocol.test.ts asserts the two agree.
  shipClass: z.enum(['battleship', 'cruiser', 'destroyer', 'submarine']),
  origin: coordSchema,
  orientation: z.enum(['horizontal', 'vertical']),
});

/**
 * `join { gameId, token }` in spec §9.
 *
 * The token is deliberately absent. It authenticates the connection and belongs to the
 * transport adapter (spec §5.2: "session cookie shared with the game layer via a signed
 * token"); the session must never see, store or log a credential. The adapter verifies
 * it and hands the session a resolved player id.
 */
export const joinIntentSchema = z.strictObject({
  type: z.literal('join'),
  gameId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
});

export const placeFleetIntentSchema = z.strictObject({
  type: z.literal('place_fleet'),
  placements: z.array(shipPlacementSchema).max(MAX_PLACEMENTS_PER_INTENT),
});

export const readyIntentSchema = z.strictObject({ type: z.literal('ready') });

export const fireIntentSchema = z.strictObject({
  type: z.literal('fire'),
  cells: z.array(coordSchema).min(1).max(MAX_CELLS_PER_FIRE),
});

/**
 * Spec §7.4 calls for "a fixed set of quick emoji reactions" but never enumerates it.
 * Choosing that set is product content, not an implementation detail, so this stays a
 * bounded opaque token; Block 11 must narrow it to `z.enum([...])` once the set exists.
 */
export const reactIntentSchema = z.strictObject({
  type: z.literal('react'),
  emoji: z.string().min(1).max(16),
});

export const resignIntentSchema = z.strictObject({ type: z.literal('resign') });

export const heartbeatIntentSchema = z.strictObject({ type: z.literal('heartbeat') });

/** The complete §9 client→server set. */
export const clientIntentSchema = z.discriminatedUnion('type', [
  joinIntentSchema,
  placeFleetIntentSchema,
  readyIntentSchema,
  fireIntentSchema,
  reactIntentSchema,
  resignIntentSchema,
  heartbeatIntentSchema,
]);

export type ClientIntent = z.infer<typeof clientIntentSchema>;
export type ClientIntentType = ClientIntent['type'];

/**
 * The envelope around a §9 intent.
 *
 * `seq` is not part of §9 — §9 defines no sequencing field at all. It is required by
 * §10 ("idempotency / sequencing on moves so a replayed/duplicated message can't
 * double-fire"), so it is carried *around* the intent rather than bolted into each
 * intent shape. That keeps §9's payloads exactly as the spec writes them and keeps
 * replay protection a transport-envelope concern.
 *
 * Per-connection monotonic, starting at 0. See `session.ts` for the accept/replay/stale
 * rules.
 */
export const clientMessageSchema = z.strictObject({
  seq: z.int().min(0),
  intent: clientIntentSchema,
});

export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Intents the session layer owns. `join`/`heartbeat` are connection lifecycle. */
export const GAME_INTENTS: readonly ClientIntentType[] = [
  'place_fleet',
  'ready',
  'fire',
  'react',
  'resign',
];

/** Intents the future transport adapter owns; the session rejects them. */
export const TRANSPORT_INTENTS: readonly ClientIntentType[] = ['join', 'heartbeat'];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Failures the session itself detects. Everything about *Battleship* reuses the
 * engine's own codes instead — see `SessionErrorCode`.
 */
export type SessionOwnErrorCode =
  /** Failed schema validation: wrong shape, wrong types, unknown keys, oversized. */
  | 'malformed_intent'
  /** The sender holds no seat in this game (spec §10: ownership). */
  | 'not_a_participant'
  /** A well-formed intent this block does not implement yet. */
  | 'unsupported_intent'
  /** `seq` is behind the last accepted one — an out-of-order or forged replay. */
  | 'stale_sequence'
  /** Wrong number of cells for the mode (spec §9: "wrong salvo size"). */
  | 'wrong_salvo_size'
  /** `ready` before a fleet has been accepted. */
  | 'fleet_not_placed';

/**
 * Every code a session rejection can carry.
 *
 * The engine's codes are reused verbatim rather than remapped, so the wire vocabulary
 * and the engine's vocabulary can never drift apart.
 */
export type SessionErrorCode = SessionOwnErrorCode | FireError['code'] | PlaceFleetError['code'];

export interface SessionError {
  readonly code: SessionErrorCode;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Server → client events (spec §9)
// ---------------------------------------------------------------------------

/** One resolved cell in a `fire_result` (spec §9). */
export interface FireResultCell {
  readonly coord: Coord;
  readonly outcome: ShotOutcome;
  /** Present only on `sunk`, when the outline is legitimately revealed (spec §4). */
  readonly shipOutline?: readonly Coord[];
}

/**
 * The §9 `state_snapshot`. Carries a `PlayerView` — the only representation of a game
 * a player may receive — rather than §9's loose `{ yourBoard, opponentRevealed, ... }`,
 * because `PlayerView` is the shape the hidden-information filter already produces and
 * the UI already renders.
 *
 * §9's `timers` and `scores` fields are absent: timers are Block 9 (spec §4) and
 * Classic has no score beyond ships remaining, which the view already carries.
 */
export interface StateSnapshotEvent {
  readonly type: 'state_snapshot';
  readonly view: PlayerView;
  /** Server-side revision of the authoritative state; see `GameSession.revision`. */
  readonly revision: number;
}

export type ServerEvent =
  | StateSnapshotEvent
  | { readonly type: 'placement_accepted' }
  | {
      readonly type: 'placement_rejected';
      readonly reason: SessionErrorCode;
      readonly message: string;
    }
  | { readonly type: 'turn_changed'; readonly activePlayer: PlayerSlot }
  | {
      readonly type: 'fire_result';
      readonly firedBy: PlayerSlot;
      readonly cells: readonly FireResultCell[];
      readonly extraTurn: boolean;
    }
  | {
      readonly type: 'ship_sunk';
      /** Whose ship went down — public the moment it sinks (spec §4). */
      readonly owner: PlayerSlot;
      readonly shipClass: ShipClass;
      readonly outline: readonly Coord[];
      readonly bufferCells: readonly Coord[];
    }
  | {
      readonly type: 'game_over';
      readonly winner: PlayerSlot | null;
      readonly reason: ResultReason;
    }
  | { readonly type: 'error'; readonly code: SessionErrorCode; readonly message: string };

export type ServerEventType = ServerEvent['type'];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Summarises a validation failure without echoing any of the input.
 *
 * Reflecting attacker-controlled values back into an error message (and from there into
 * logs) is how injection and log-poisoning bugs start, so only the field path and the
 * issue kind travel.
 */
function describeIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.code}`;
  });
  return `Malformed intent — ${issues.join('; ')}`;
}

/** Validates an untrusted payload into a `ClientMessage`, or a `SessionError`. */
export function parseClientMessage(
  input: unknown,
):
  | { readonly ok: true; readonly message: ClientMessage }
  | { readonly ok: false; readonly error: SessionError } {
  const parsed = clientMessageSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'malformed_intent', message: describeIssues(parsed.error) },
    };
  }

  return { ok: true, message: parsed.data };
}
