import { describe, expect, it } from 'vitest';

import { abandon, concede, skipTurn } from './abandon';
import { autoPlaceFleet } from './autoplace';
import { fire } from './fire';
import { createRng } from './rng';
import { createGame, placeFleet, type GameState } from './state';

/** A game in the playing phase, seat A to move. */
function playing(): GameState {
  const fleetA = autoPlaceFleet(createRng(1));
  const fleetB = autoPlaceFleet(createRng(2));
  const withA = placeFleet(createGame({ firstTurn: 'a' }), 'a', fleetA);
  if (!withA.ok) throw new Error('fixture failed');
  const withB = placeFleet(withA.value, 'b', fleetB);
  if (!withB.ok) throw new Error('fixture failed');
  return withB.value;
}

describe('concede', () => {
  it('ends the game and awards it to the other player', () => {
    const result = concede(playing(), 'a', 'forfeit');

    expect(result.ok && result.value).toMatchObject({
      phase: 'finished',
      winner: 'b',
      resultReason: 'forfeit',
      turn: null,
    });
  });

  it('works before a shot is fired, because walking away is still abandoning', () => {
    const result = concede(createGame(), 'b', 'disconnect');
    expect(result.ok && result.value).toMatchObject({ phase: 'finished', winner: 'a' });
  });

  it.each(['forfeit', 'timeout', 'disconnect'] as const)('records %s as the reason', (reason) => {
    const result = concede(playing(), 'b', reason);
    expect(result.ok && result.value.resultReason).toBe(reason);
  });

  it('refuses to overwrite a game that has already ended', () => {
    const finished = concede(playing(), 'a', 'forfeit');
    if (!finished.ok) throw new Error('setup failed');

    const second = concede(finished.value, 'b', 'timeout');
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error.code).toBe('already_finished');
  });

  it('leaves both boards exactly as they were', () => {
    const before = playing();
    const after = concede(before, 'a', 'timeout');

    // A forfeit decides the game; it does not sink anything.
    expect(after.ok && after.value.boards).toBe(before.boards);
    expect(after.ok && after.value.moveCount).toBe(before.moveCount);
  });
});

describe('abandon', () => {
  it('ends the game with no winner at all', () => {
    const result = abandon(playing(), 'disconnect');

    expect(result.ok && result.value).toMatchObject({
      phase: 'finished',
      winner: null,
      resultReason: 'disconnect',
      turn: null,
    });
  });

  it('refuses a game that has already ended', () => {
    const finished = concede(playing(), 'a', 'forfeit');
    if (!finished.ok) throw new Error('setup failed');

    expect(abandon(finished.value, 'disconnect').ok).toBe(false);
  });
});

describe('skipTurn', () => {
  it('passes the turn to the other player', () => {
    const result = skipTurn(playing(), 'a');
    expect(result.ok && result.value.turn).toBe('b');
  });

  it('reveals nothing: no cell is marked and no shot is counted', () => {
    const before = playing();
    const after = skipTurn(before, 'a');
    if (!after.ok) throw new Error('skip failed');

    // The point of skipping rather than auto-firing: a forced miss would tell the
    // opponent that a cell they never chose is empty.
    expect(after.value.boards).toBe(before.boards);
    expect(after.value.moveCount).toBe(before.moveCount);
  });

  it('refuses when it is the other player’s turn', () => {
    const result = skipTurn(playing(), 'b');
    expect(!result.ok && result.error.code).toBe('not_your_turn');
  });

  it('refuses outside the playing phase', () => {
    expect(!skipTurn(createGame(), 'a').ok).toBe(true);
  });

  it('hands the turn back after the opponent misses', () => {
    const start = playing();
    const skipped = skipTurn(start, 'a');
    if (!skipped.ok) throw new Error('skip failed');

    // Find a cell that misses, so the turn comes back to A rather than granting
    // an extra turn on a hit.
    let state = skipped.value;
    for (let x = 0; x < 10 && state.turn === 'b'; x += 1) {
      for (let y = 0; y < 10 && state.turn === 'b'; y += 1) {
        const shot = fire(state, 'b', { x, y });
        if (shot.ok && shot.value.event.outcome === 'miss') {
          state = shot.value.state;
        }
      }
    }

    expect(state.turn).toBe('a');
  });
});
