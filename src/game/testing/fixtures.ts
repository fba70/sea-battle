import type { ShipPlacement } from '../types';

/**
 * A hand-verified legal fleet (spec §4: 1x4, 2x3, 3x2, 4x1, no touching).
 * Confined to columns A-H so tests can fire into columns I/J and be certain of a miss.
 *
 *    A B C D E F G H I J
 *  1 4 4 4 4 . 3 3 3 . .
 *  2 . . . . . . . . . .
 *  3 3 3 3 . 2 2 . 1 . .
 *  4 . . . . . . . . . .
 *  5 2 2 . 1 . 1 . 1 . .
 *  6 . . . . . . . . . .
 *  7 2 2 . . . . . . . .
 */
export const FLEET_A: readonly ShipPlacement[] = [
  { shipClass: 'battleship', origin: { x: 0, y: 0 }, orientation: 'horizontal' },
  { shipClass: 'cruiser', origin: { x: 5, y: 0 }, orientation: 'horizontal' },
  { shipClass: 'cruiser', origin: { x: 0, y: 2 }, orientation: 'horizontal' },
  { shipClass: 'destroyer', origin: { x: 4, y: 2 }, orientation: 'horizontal' },
  { shipClass: 'destroyer', origin: { x: 0, y: 4 }, orientation: 'horizontal' },
  { shipClass: 'destroyer', origin: { x: 0, y: 6 }, orientation: 'horizontal' },
  { shipClass: 'submarine', origin: { x: 7, y: 2 }, orientation: 'horizontal' },
  { shipClass: 'submarine', origin: { x: 3, y: 4 }, orientation: 'horizontal' },
  { shipClass: 'submarine', origin: { x: 5, y: 4 }, orientation: 'horizontal' },
  { shipClass: 'submarine', origin: { x: 7, y: 4 }, orientation: 'horizontal' },
];

/**
 * The same fleet shifted one row down: structurally different, still legal, and
 * sharing no cell with FLEET_A. Used by the hidden-information differential test.
 */
export const FLEET_B: readonly ShipPlacement[] = FLEET_A.map((placement) => ({
  ...placement,
  origin: { x: placement.origin.x, y: placement.origin.y + 1 },
}));

/** Columns I and J (x = 8, 9) hold no ship in either fixture fleet. */
export const ALWAYS_EMPTY_COLUMNS: readonly number[] = [8, 9];
