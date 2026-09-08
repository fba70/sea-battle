import { bufferAround, isOnBoard, toIndex, type CellIndex } from './coord';
import { FLEET } from './constants';
import { err, ok, type Result } from './result';
import type { Coord, Orientation, Ship, ShipClass, ShipPlacement } from './types';

export type PlacementErrorCode =
  | 'invalid_coordinate'
  | 'invalid_orientation'
  | 'invalid_ship_class'
  | 'out_of_bounds'
  | 'wrong_fleet_composition'
  | 'ships_overlap'
  | 'ships_touch';

export interface PlacementError {
  readonly code: PlacementErrorCode;
  readonly message: string;
  /** Index into the submitted placements array, when the fault is one ship's. */
  readonly placementIndex?: number;
  readonly coord?: Coord;
}

const SHIP_SIZES: Readonly<Record<ShipClass, number>> = Object.fromEntries(
  FLEET.map((entry) => [entry.shipClass, entry.size]),
) as Record<ShipClass, number>;

const REQUIRED_COUNTS: Readonly<Record<ShipClass, number>> = Object.fromEntries(
  FLEET.map((entry) => [entry.shipClass, entry.count]),
) as Record<ShipClass, number>;

const ORIENTATIONS: readonly Orientation[] = ['horizontal', 'vertical'];

export function sizeOfShipClass(shipClass: ShipClass): number {
  return SHIP_SIZES[shipClass];
}

export function isShipClass(value: unknown): value is ShipClass {
  return typeof value === 'string' && value in SHIP_SIZES;
}

/** The cells a placement occupies, in bow-to-stern order. Does not check the board. */
export function cellsOfPlacement(placement: ShipPlacement): Coord[] {
  const size = sizeOfShipClass(placement.shipClass);
  return Array.from({ length: size }, (_, offset) =>
    placement.orientation === 'horizontal'
      ? { x: placement.origin.x + offset, y: placement.origin.y }
      : { x: placement.origin.x, y: placement.origin.y + offset },
  );
}

function shipIdFor(shipClass: ShipClass, ordinal: number): string {
  return `${shipClass}-${ordinal}`;
}

/**
 * Shared implementation for full and partial fleet validation.
 *
 * `requireFullFleet` is the only difference: a partially-built fleet is checked
 * for geometry (bounds, overlap, touching) but not for composition, which is what
 * the placement UI needs while the player is still positioning ships.
 */
function validatePlacements(
  placements: readonly ShipPlacement[],
  requireFullFleet: boolean,
): Result<readonly Ship[], PlacementError> {
  const counts = new Map<ShipClass, number>();

  // Occupied cells, and the cells blocked by the one-cell buffer around them.
  const occupied = new Map<CellIndex, number>();
  const blocked = new Set<CellIndex>();
  const ships: Ship[] = [];

  for (const [placementIndex, placement] of placements.entries()) {
    if (!isShipClass(placement.shipClass)) {
      return err({
        code: 'invalid_ship_class',
        message: `Unknown ship class: ${String(placement.shipClass)}`,
        placementIndex,
      });
    }

    if (!ORIENTATIONS.includes(placement.orientation)) {
      return err({
        code: 'invalid_orientation',
        message: `Ships must be horizontal or vertical, got: ${String(placement.orientation)}`,
        placementIndex,
      });
    }

    const { origin } = placement;
    if (
      typeof origin?.x !== 'number' ||
      typeof origin.y !== 'number' ||
      !Number.isInteger(origin.x) ||
      !Number.isInteger(origin.y)
    ) {
      return err({
        code: 'invalid_coordinate',
        message: 'Ship origin must be a pair of integers',
        placementIndex,
      });
    }

    const cells = cellsOfPlacement(placement);

    for (const cell of cells) {
      if (!isOnBoard(cell)) {
        return err({
          code: 'out_of_bounds',
          message: `Ship extends off the board at ${cell.x},${cell.y}`,
          placementIndex,
          coord: cell,
        });
      }
    }

    for (const cell of cells) {
      const index = toIndex(cell);
      if (occupied.has(index)) {
        return err({
          code: 'ships_overlap',
          message: `Two ships occupy ${cell.x},${cell.y}`,
          placementIndex,
          coord: cell,
        });
      }
    }

    for (const cell of cells) {
      if (blocked.has(toIndex(cell))) {
        return err({
          code: 'ships_touch',
          message: `Ships may not touch, not even diagonally (at ${cell.x},${cell.y})`,
          placementIndex,
          coord: cell,
        });
      }
    }

    const ordinal = counts.get(placement.shipClass) ?? 0;
    counts.set(placement.shipClass, ordinal + 1);

    for (const cell of cells) {
      occupied.set(toIndex(cell), placementIndex);
    }
    for (const cell of bufferAround(cells)) {
      blocked.add(toIndex(cell));
    }

    ships.push({
      id: shipIdFor(placement.shipClass, ordinal),
      shipClass: placement.shipClass,
      size: sizeOfShipClass(placement.shipClass),
      origin: { x: origin.x, y: origin.y },
      // A 1-cell ship is orientation-agnostic; canonicalise so equal fleets compare equal.
      orientation:
        sizeOfShipClass(placement.shipClass) === 1 ? 'horizontal' : placement.orientation,
      cells,
    });
  }

  for (const entry of FLEET) {
    const actual = counts.get(entry.shipClass) ?? 0;
    const required = REQUIRED_COUNTS[entry.shipClass];

    // A partial fleet may be short of ships, but never over-supplied.
    const wrong = requireFullFleet ? actual !== required : actual > required;
    if (wrong) {
      return err({
        code: 'wrong_fleet_composition',
        message: `Fleet must contain exactly ${entry.count} x ${entry.shipClass}, got ${actual}`,
      });
    }
  }

  return ok(ships);
}

/**
 * Validates a proposed fleet against the full spec §4 ruleset:
 * exact fleet composition, straight horizontal/vertical ships, fully on-board,
 * no overlap, and no touching — diagonals included.
 *
 * The client's placement UI produces a *proposal*; this is the re-validation the
 * trust model (spec §5.3) requires before it is ever accepted.
 */
export function validateFleet(
  placements: readonly ShipPlacement[],
): Result<readonly Ship[], PlacementError> {
  return validatePlacements(placements, true);
}

/**
 * Geometry-only validation for a fleet that is still being built: every rule
 * except "all ten ships are present". Used for live feedback during placement.
 */
export function validatePartialFleet(
  placements: readonly ShipPlacement[],
): Result<readonly Ship[], PlacementError> {
  return validatePlacements(placements, false);
}

/**
 * Whether `candidate` can join an already-valid set of placements. Returns the
 * blocking error, or null when the placement is legal.
 */
export function canPlaceShip(
  existing: readonly ShipPlacement[],
  candidate: ShipPlacement,
): PlacementError | null {
  const result = validatePartialFleet([...existing, candidate]);
  return result.ok ? null : result.error;
}

/** How many ships of each class are still waiting to be placed. */
export function remainingFleetCounts(placements: readonly ShipPlacement[]): Map<ShipClass, number> {
  const remaining = new Map<ShipClass, number>(
    FLEET.map((entry) => [entry.shipClass, entry.count]),
  );

  for (const placement of placements) {
    const left = remaining.get(placement.shipClass);
    if (left !== undefined) {
      remaining.set(placement.shipClass, Math.max(0, left - 1));
    }
  }

  return remaining;
}

export function isFleetValid(placements: readonly ShipPlacement[]): boolean {
  return validateFleet(placements).ok;
}
