import { fire } from '../fire';
import { createGame, placeFleet, type GameState } from '../state';
import type { Coord, PlayerSlot, ShipPlacement } from '../types';
import { FLEET_A, FLEET_B } from './fixtures';

/** A game with both fleets placed and player A to move. */
export function startedGame(
  fleetA: readonly ShipPlacement[] = FLEET_A,
  fleetB: readonly ShipPlacement[] = FLEET_B,
  firstTurn: PlayerSlot = 'a',
): GameState {
  const placedA = placeFleet(createGame({ firstTurn }), 'a', fleetA);
  if (!placedA.ok) {
    throw new Error(`fixture fleet A is illegal: ${placedA.error.code}`);
  }

  const placedB = placeFleet(placedA.value, 'b', fleetB);
  if (!placedB.ok) {
    throw new Error(`fixture fleet B is illegal: ${placedB.error.code}`);
  }

  return placedB.value;
}

/** Fires a sequence of shots, asserting each is accepted. */
export function fireAll(state: GameState, slot: PlayerSlot, coords: readonly Coord[]): GameState {
  return coords.reduce((current, coord) => {
    const result = fire(current, slot, coord);
    if (!result.ok) {
      throw new Error(`unexpected rejection at ${coord.x},${coord.y}: ${result.error.code}`);
    }
    return result.value.state;
  }, state);
}
