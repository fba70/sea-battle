'use client';

import { useCallback, useMemo, useState } from 'react';

import { BOARD_SIZE, FLEET } from '@/game/constants';
import {
  canPlaceShip,
  cellsOfPlacement,
  isFleetValid,
  remainingFleetCounts,
  sizeOfShipClass,
} from '@/game/placement';
import type { Coord, Orientation, ShipClass, ShipPlacement } from '@/game/types';
import { clampToBoard } from './board-model';

export interface PlacementDraft {
  readonly placements: readonly ShipPlacement[];
  readonly selected: ShipClass | null;
  readonly orientation: Orientation;
  readonly cursor: Coord;
  readonly hover: Coord | null;
  readonly remaining: ReadonlyMap<ShipClass, number>;
  readonly ghost: { cells: readonly Coord[]; valid: boolean } | null;
  readonly complete: boolean;
  readonly invalidPulse: number;
  readonly dragging: boolean;
}

export interface PlacementActions {
  selectShip: (shipClass: ShipClass | null) => void;
  rotate: () => void;
  setCursor: (coord: Coord) => void;
  setHover: (coord: Coord | null) => void;
  placeAt: (coord: Coord) => boolean;
  activateCell: (coord: Coord) => void;
  beginDrag: (shipClass: ShipClass) => void;
  reset: () => void;
  applyFleet: (placements: readonly ShipPlacement[]) => void;
}

function shipAt(placements: readonly ShipPlacement[], coord: Coord): ShipPlacement | undefined {
  return placements.find((placement) =>
    cellsOfPlacement(placement).some((cell) => cell.x === coord.x && cell.y === coord.y),
  );
}

/** The first ship class that still has an unplaced hull, largest first. */
function nextShipClass(remaining: ReadonlyMap<ShipClass, number>): ShipClass | null {
  const ordered = [...FLEET].sort((a, b) => b.size - a.size);
  for (const entry of ordered) {
    if ((remaining.get(entry.shipClass) ?? 0) > 0) {
      return entry.shipClass;
    }
  }
  return null;
}

export function useFleetPlacement(): [PlacementDraft, PlacementActions] {
  const [placements, setPlacements] = useState<readonly ShipPlacement[]>([]);
  const [picked, setPicked] = useState<ShipClass | null>(null);
  const [orientation, setOrientation] = useState<Orientation>('horizontal');
  const [cursor, setCursorState] = useState<Coord>({ x: 0, y: 0 });
  const [hover, setHoverState] = useState<Coord | null>(null);
  const [invalidPulse, setInvalidPulse] = useState(0);
  const [dragging, setDragging] = useState(false);

  const remaining = useMemo(() => remainingFleetCounts(placements), [placements]);
  const complete = useMemo(() => isFleetValid(placements), [placements]);

  // Derived rather than synced: once the last hull of a class is placed the
  // selection rolls on to the next unplaced ship, so the flow never stalls.
  const selected = useMemo(
    () => (picked && (remaining.get(picked) ?? 0) > 0 ? picked : nextShipClass(remaining)),
    [picked, remaining],
  );

  const target = hover ?? cursor;

  const ghost = useMemo(() => {
    if (!selected) return null;

    const candidate: ShipPlacement = { shipClass: selected, origin: target, orientation };
    const cells = cellsOfPlacement(candidate);
    const onBoard = cells.every(
      (cell) => cell.x >= 0 && cell.y >= 0 && cell.x < BOARD_SIZE && cell.y < BOARD_SIZE,
    );

    return {
      cells: cells.filter(
        (cell) => cell.x >= 0 && cell.y >= 0 && cell.x < BOARD_SIZE && cell.y < BOARD_SIZE,
      ),
      valid: onBoard && canPlaceShip(placements, candidate) === null,
    };
  }, [selected, target, orientation, placements]);

  const placeAt = useCallback(
    (coord: Coord): boolean => {
      if (!selected || (remaining.get(selected) ?? 0) === 0) {
        return false;
      }

      const candidate: ShipPlacement = { shipClass: selected, origin: coord, orientation };
      const cells = cellsOfPlacement(candidate);
      const onBoard = cells.every(
        (cell) => cell.x >= 0 && cell.y >= 0 && cell.x < BOARD_SIZE && cell.y < BOARD_SIZE,
      );

      if (!onBoard || canPlaceShip(placements, candidate) !== null) {
        setInvalidPulse((pulse) => pulse + 1);
        return false;
      }

      setPlacements((current) => [...current, candidate]);
      setDragging(false);
      return true;
    },
    [selected, orientation, placements, remaining],
  );

  /** Clicking a placed ship lifts it back off the board so it can be moved. */
  const activateCell = useCallback(
    (coord: Coord) => {
      const existing = shipAt(placements, coord);

      if (existing) {
        setPlacements((current) => current.filter((placement) => placement !== existing));
        setPicked(existing.shipClass);
        setOrientation(existing.orientation);
        setCursorState(coord);
        return;
      }

      placeAt(coord);
    },
    [placements, placeAt],
  );

  return [
    {
      placements,
      selected,
      orientation,
      cursor,
      hover,
      remaining,
      ghost,
      complete,
      invalidPulse,
      dragging,
    },
    {
      selectShip: (shipClass) => {
        setPicked(shipClass);
      },
      rotate: () => {
        setOrientation((current) => (current === 'horizontal' ? 'vertical' : 'horizontal'));
      },
      setCursor: (coord) => {
        setCursorState(clampToBoard(coord));
      },
      setHover: (coord) => {
        setHoverState(coord);
      },
      placeAt,
      activateCell,
      beginDrag: (shipClass) => {
        setPicked(shipClass);
        setDragging(true);
      },
      reset: () => {
        setPlacements([]);
        setPicked(null);
        setOrientation('horizontal');
        setDragging(false);
      },
      applyFleet: (next) => {
        setPlacements(next);
        setPicked(null);
        setDragging(false);
      },
    },
  ];
}

export { sizeOfShipClass };
