/**
 * Core domain vocabulary, transcribed from spec §4 (ruleset) and §9 (protocol).
 *
 * This module is pure: no React, no Next, no database, no transport. See
 * src/game/index.ts for why.
 */

/** Zero-based board coordinates. Column 0 = 'A', row 0 = '1'. */
export interface Coord {
  readonly x: number;
  readonly y: number;
}

export type Orientation = 'horizontal' | 'vertical';

/** Spec §4: 4-deck battleship, 3-deck cruisers, 2-deck destroyers, 1-deck submarines. */
export type ShipClass = 'battleship' | 'cruiser' | 'destroyer' | 'submarine';

export interface ShipPlacement {
  readonly shipClass: ShipClass;
  /** Top-left-most cell of the ship. */
  readonly origin: Coord;
  readonly orientation: Orientation;
}

/** Spec §9: `fire_result` outcomes. */
export type ShotOutcome = 'miss' | 'hit' | 'sunk';

/** Spec §4: Classic (hit = fire again) and Salvo (N shots per turn). */
export type GameMode = 'classic' | 'salvo';

/** Spec §9: `state_snapshot.phase`. */
export type GamePhase = 'placement' | 'playing' | 'finished';

/** The two seats in a game; matches `games.player_a_id` / `player_b_id` in spec §6. */
export type PlayerSlot = 'a' | 'b';

/** Spec §6: `games.result_reason`. */
export type ResultReason = 'sunk_all' | 'forfeit' | 'timeout' | 'disconnect';
