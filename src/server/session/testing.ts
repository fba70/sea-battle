/**
 * Shared fixtures for the session tests. Test-only; nothing in the app imports this.
 */
import { FLEET_A, FLEET_B } from '@/game/testing/fixtures';
import type { Coord, PlayerSlot, ShipPlacement } from '@/game/types';

import type { ClientIntent, ServerEvent } from './protocol';
import { applyIntent, createSession, type GameSession, type SessionOutcome } from './session';

export const PLAYER_A = 'player-a-id';
export const PLAYER_B = 'player-b-id';
export const STRANGER = 'someone-else-id';
export const GAME_ID = 'game-under-test';

/** A miss on both fixture fleets: columns I and J (x = 8, 9) are always empty. */
export const ALWAYS_MISS: Coord = { x: 9, y: 9 };

export function newSession(firstTurn: PlayerSlot = 'a'): GameSession {
  return createSession({ gameId: GAME_ID, seats: { a: PLAYER_A, b: PLAYER_B }, firstTurn });
}

export function send(
  session: GameSession,
  playerId: string,
  intent: ClientIntent,
  seq: number,
): SessionOutcome {
  return applyIntent(session, playerId, { seq, intent });
}

/** A fixed, readable starting instant for clock tests. */
export const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);

/** A session whose clock is running, as the Durable Object creates one. */
export function newTimedSession(now: number = T0, firstTurn: PlayerSlot = 'a'): GameSession {
  return createSession({ gameId: GAME_ID, seats: { a: PLAYER_A, b: PLAYER_B }, firstTurn, now });
}

/** `send`, but with a server time attached so deadlines move. */
export function sendAt(
  session: GameSession,
  playerId: string,
  intent: ClientIntent,
  seq: number,
  now: number,
): SessionOutcome {
  return applyIntent(session, playerId, { seq, intent }, now);
}

function mustAccept(outcome: SessionOutcome, what: string): GameSession {
  if (outcome.status !== 'accepted') {
    throw new Error(`fixture setup failed at ${what}: ${outcome.error?.code ?? outcome.status}`);
  }
  return outcome.session;
}

/**
 * Both fleets installed through the real `place_fleet` path, so every test that needs a
 * game in progress also exercises the placement handler.
 */
export function startedSession(
  fleetA: readonly ShipPlacement[] = FLEET_A,
  fleetB: readonly ShipPlacement[] = FLEET_B,
  firstTurn: PlayerSlot = 'a',
): GameSession {
  let session = newSession(firstTurn);
  session = mustAccept(
    send(session, PLAYER_A, { type: 'place_fleet', placements: [...fleetA] }, 0),
    'player A placement',
  );
  session = mustAccept(
    send(session, PLAYER_B, { type: 'place_fleet', placements: [...fleetB] }, 0),
    'player B placement',
  );
  return session;
}

/** Seat -> player id, for driving a scripted game from either side. */
export function playerIdOf(seat: PlayerSlot): string {
  return seat === 'a' ? PLAYER_A : PLAYER_B;
}

export function eventTypes(events: readonly ServerEvent[]): string[] {
  return events.map((event) => event.type);
}
