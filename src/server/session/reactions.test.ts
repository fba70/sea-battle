import { describe, expect, it } from 'vitest';

import { applyIntent } from './session';
import { isReaction, REACTIONS, REACTION_BURST, REACTION_REFILL_MS } from './reactions';
import { newTimedSession, sendAt, startedSession, PLAYER_A, PLAYER_B, T0 } from './testing';
import type { GameSession } from './session';

/** A started game whose clock is running, so the budget can be measured. */
function timedGame(): GameSession {
  return newTimedSession();
}

const react = (session: GameSession, player: string, emoji: string, seq: number, now: number) =>
  sendAt(session, player, { type: 'react', emoji } as never, seq, now);

describe('the reaction set', () => {
  it('is the six agreed reactions and nothing else', () => {
    expect([...REACTIONS]).toEqual(['👏', '😮', '😂', '🔥', '😭', '🫡']);
  });

  it('recognises only its own members', () => {
    expect(isReaction('🔥')).toBe(true);
    expect(isReaction('💩')).toBe(false);
    expect(isReaction('')).toBe(false);
  });

  it('refuses anything outside the set at the boundary', () => {
    // The vocabulary is the entire moderation strategy, so this is the whole defence
    // against someone sending arbitrary text through the reaction channel.
    const outcome = react(timedGame(), PLAYER_A, '💩', 0, T0);

    expect(outcome.status).toBe('rejected');
    expect(outcome.error?.code).toBe('malformed_intent');
  });

  it('refuses a long string dressed up as an emoji', () => {
    const outcome = react(timedGame(), PLAYER_A, 'x'.repeat(16), 0, T0);
    expect(outcome.status).toBe('rejected');
  });
});

describe('sending a reaction', () => {
  it('reaches both players, and says who sent it', () => {
    const outcome = react(timedGame(), PLAYER_A, '🔥', 0, T0);

    expect(outcome.status).toBe('accepted');
    expect(outcome.events.a).toEqual([{ type: 'reaction', from: 'a', emoji: '🔥' }]);
    expect(outcome.events.b).toEqual([{ type: 'reaction', from: 'a', emoji: '🔥' }]);
  });

  it('changes nothing about the game', () => {
    const before = timedGame();
    const after = react(before, PLAYER_B, '👏', 0, T0).session;

    // Not a move: no board, no revision, and above all no extra time on the clock.
    expect(after.state).toBe(before.state);
    expect(after.revision).toBe(before.revision);
    expect(after.clock).toEqual(before.clock);
  });

  it('works during fleet placement, not only during the battle', () => {
    expect(react(newTimedSession(), PLAYER_A, '🫡', 0, T0).status).toBe('accepted');
  });

  it('is refused once the match is over', () => {
    const finished = sendAt(timedGame(), PLAYER_A, { type: 'resign' }, 0, T0).session;
    const outcome = react(finished, PLAYER_B, '🫡', 1, T0 + 1_000);

    expect(outcome.status).toBe('rejected');
    expect(outcome.error?.code).toBe('wrong_phase');
  });

  it('is refused from someone with no seat in the game', () => {
    const outcome = react(timedGame(), 'a-stranger', '🔥', 0, T0);
    expect(outcome.error?.code).toBe('not_a_participant');
  });
});

describe('spam prevention (spec §10)', () => {
  it('allows a burst, then refuses', () => {
    let session = timedGame();

    for (let n = 0; n < REACTION_BURST; n += 1) {
      const outcome = react(session, PLAYER_A, '😂', n, T0 + n);
      expect(outcome.status, `reaction ${n + 1}`).toBe('accepted');
      session = outcome.session;
    }

    const over = react(session, PLAYER_A, '😂', REACTION_BURST, T0 + REACTION_BURST);
    expect(over.status).toBe('rejected');
    expect(over.error?.code).toBe('rate_limited');
  });

  it('refuses without relaying anything to the opponent', () => {
    let session = timedGame();
    for (let n = 0; n < REACTION_BURST; n += 1) {
      session = react(session, PLAYER_A, '😂', n, T0).session;
    }

    const over = react(session, PLAYER_A, '😂', REACTION_BURST, T0);
    expect(over.events.b).toEqual([]);
  });

  it('lets the sender through again once it has refilled', () => {
    let session = timedGame();
    for (let n = 0; n < REACTION_BURST; n += 1) {
      session = react(session, PLAYER_A, '😂', n, T0).session;
    }

    const later = react(session, PLAYER_A, '😂', REACTION_BURST, T0 + REACTION_REFILL_MS);
    expect(later.status).toBe('accepted');
  });

  it('budgets each player separately', () => {
    let session = timedGame();
    for (let n = 0; n < REACTION_BURST; n += 1) {
      session = react(session, PLAYER_A, '😂', n, T0).session;
    }

    // One player exhausting their allowance must not silence the other.
    expect(react(session, PLAYER_B, '👏', 0, T0).status).toBe('accepted');
  });

  it('never refills beyond the burst, however long the wait', () => {
    let session = timedGame();
    session = react(session, PLAYER_A, '😂', 0, T0).session;

    const muchLater = T0 + 10 * 60 * 1000;
    for (let n = 0; n < REACTION_BURST; n += 1) {
      const outcome = react(session, PLAYER_A, '😂', n + 1, muchLater + n);
      expect(outcome.status).toBe('accepted');
      session = outcome.session;
    }

    expect(react(session, PLAYER_A, '😂', 99, muchLater + REACTION_BURST).status).toBe('rejected');
  });

  it('does not limit a session with no clock, which is a test, not a player', () => {
    let session = startedSession();
    for (let n = 0; n < REACTION_BURST + 3; n += 1) {
      // Seat A already used seq 0 placing its fleet, so start past it.
      const outcome = applyIntent(session, PLAYER_A, {
        seq: n + 1,
        intent: { type: 'react', emoji: '🔥' },
      });
      expect(outcome.status).toBe('accepted');
      session = outcome.session;
    }
  });
});
