import { BOARD_SIZE, FLEET } from './constants';
import { bufferAround, toIndex, isOnBoard, type CellIndex } from './coord';
import { cellsOfPlacement, sizeOfShipClass, validateFleet } from './placement';
import type { Rng } from './rng';
import type { Orientation, Ship, ShipClass, ShipPlacement } from './types';

/** Largest ships first — they are the hardest to fit once the board fills up. */
const PLACEMENT_ORDER: readonly ShipClass[] = FLEET.flatMap((entry) =>
  Array.from({ length: entry.count }, () => entry.shipClass),
).sort((a, b) => sizeOfShipClass(b) - sizeOfShipClass(a));

const ORIENTATIONS: readonly Orientation[] = ['horizontal', 'vertical'];

function candidatePlacements(
  shipClass: ShipClass,
  blocked: ReadonlySet<CellIndex>,
): ShipPlacement[] {
  const size = sizeOfShipClass(shipClass);
  // A 1-cell ship is orientation-agnostic; enumerating both would double-weight it.
  const orientations = size === 1 ? ORIENTATIONS.slice(0, 1) : ORIENTATIONS;
  const candidates: ShipPlacement[] = [];

  for (const orientation of orientations) {
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const placement: ShipPlacement = { shipClass, origin: { x, y }, orientation };
        const cells = cellsOfPlacement(placement);

        if (cells.some((cell) => !isOnBoard(cell) || blocked.has(toIndex(cell)))) {
          continue;
        }
        candidates.push(placement);
      }
    }
  }

  return candidates;
}

/**
 * Produces a random fleet that always satisfies the spec §4 constraints
 * ("auto-placement guarantees it"). Deterministic for a given `Rng` seed.
 *
 * Ships are placed largest-first onto uniformly-chosen legal positions; a cell is
 * legal only if neither it nor its one-cell buffer is already taken, so the result
 * can never overlap or touch. Restarts if a fleet paints itself into a corner.
 */
export function autoPlaceFleet(rng: Rng, maxAttempts = 100): readonly Ship[] {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const blocked = new Set<CellIndex>();
    const placements: ShipPlacement[] = [];
    let stuck = false;

    for (const shipClass of PLACEMENT_ORDER) {
      const candidates = candidatePlacements(shipClass, blocked);
      if (candidates.length === 0) {
        stuck = true;
        break;
      }

      const chosen = rng.pick(candidates);
      const cells = cellsOfPlacement(chosen);

      for (const cell of cells) {
        blocked.add(toIndex(cell));
      }
      for (const cell of bufferAround(cells)) {
        blocked.add(toIndex(cell));
      }

      placements.push(chosen);
    }

    if (stuck) {
      continue;
    }

    // Belt and braces: the generator should be correct by construction, but the
    // authoritative validator is the single source of truth for legality.
    const validated = validateFleet(placements);
    if (validated.ok) {
      return validated.value;
    }
  }

  throw new Error(`Auto-placement failed to produce a legal fleet in ${maxAttempts} attempts`);
}
