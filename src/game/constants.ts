import type { ShipClass } from './types';

/** Spec §4: 10x10 grid, columns A-J, rows 1-10. */
export const BOARD_SIZE = 10;

export interface FleetEntry {
  readonly shipClass: ShipClass;
  /** Number of cells the ship occupies. */
  readonly size: number;
  /** How many ships of this class each player fields. */
  readonly count: number;
}

/** Spec §4: 10 ships, 20 cells. */
export const FLEET: readonly FleetEntry[] = [
  { shipClass: 'battleship', size: 4, count: 1 },
  { shipClass: 'cruiser', size: 3, count: 2 },
  { shipClass: 'destroyer', size: 2, count: 3 },
  { shipClass: 'submarine', size: 1, count: 4 },
];

export const FLEET_SHIP_COUNT = FLEET.reduce((total, entry) => total + entry.count, 0);

export const FLEET_CELL_COUNT = FLEET.reduce((total, entry) => total + entry.count * entry.size, 0);

/** Column labels A-J for display and coordinate parsing. */
export const COLUMN_LABELS = Array.from({ length: BOARD_SIZE }, (_, index) =>
  String.fromCharCode(65 + index),
);

/**
 * Spec §4 default timers, in milliseconds. Configurable per game type.
 * Note: the Classic consecutive-expiry forfeit threshold (K) is still unspecified,
 * and the Salvo timeout policy is Open Question OQ-3 — neither is encoded here yet.
 */
export const DEFAULT_TIMERS = {
  placementMs: 60_000,
  moveMs: { classic: 30_000, salvo: 45_000 },
  disconnectGraceMs: 30_000,
} as const;
