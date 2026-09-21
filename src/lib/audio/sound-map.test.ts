import { describe, expect, it } from 'vitest';

import {
  IMPACT_DELAY_MS,
  RESULT_DELAY_MS,
  soundsForTransition,
  TURN_CUE_DELAY_MS,
  type AudioSnapshot,
} from './sound-map';

const base: AudioSnapshot = {
  phase: 'placement',
  logLength: 0,
  lastShot: undefined,
  awaitingBot: false,
  humanWon: false,
  humanLost: false,
  placedCount: 0,
  invalidCount: 0,
};

const at = (patch: Partial<AudioSnapshot>): AudioSnapshot => ({ ...base, ...patch });
const ids = (snapshots: ReturnType<typeof soundsForTransition>) => snapshots.map((s) => s.id);

describe('autoplay safety', () => {
  it('plays nothing on the very first snapshot', () => {
    // A fresh mount is not a user gesture (spec §7.2).
    expect(soundsForTransition(null, at({ phase: 'playing' }))).toEqual([]);
  });

  it('plays nothing when nothing changed', () => {
    const state = at({ phase: 'playing', logLength: 4 });
    expect(soundsForTransition(state, state)).toEqual([]);
  });
});

describe('placement sounds', () => {
  it('plays a settle when a ship is placed', () => {
    expect(ids(soundsForTransition(base, at({ placedCount: 1 })))).toEqual(['place']);
  });

  it('plays a rejection when a placement is refused', () => {
    expect(ids(soundsForTransition(base, at({ invalidCount: 1 })))).toEqual(['invalid']);
  });

  it('does not replay when the fleet is merely re-rendered', () => {
    const placed = at({ placedCount: 3 });
    expect(soundsForTransition(placed, placed)).toEqual([]);
  });

  it('plays a single settle for auto-place, not one per ship', () => {
    expect(ids(soundsForTransition(base, at({ placedCount: 10 })))).toEqual(['place']);
  });
});

describe('shot sounds', () => {
  const playing = at({ phase: 'playing' });

  it.each([
    ['miss', 'miss'],
    ['hit', 'hit'],
    ['sunk', 'sink'],
  ] as const)('maps outcome %s to the %s sound', (outcome, expected) => {
    const next = at({ phase: 'playing', logLength: 1, lastShot: { outcome } });

    expect(ids(soundsForTransition(playing, next))).toEqual(['fire', expected]);
  });

  it('separates the launch from the impact', () => {
    const next = at({ phase: 'playing', logLength: 1, lastShot: { outcome: 'hit' } });
    const sounds = soundsForTransition(playing, next);

    expect(sounds[0]).toEqual({ id: 'fire', delayMs: 0 });
    expect(sounds[1]).toEqual({ id: 'hit', delayMs: IMPACT_DELAY_MS });
  });

  it('fires once per log entry, not once per render', () => {
    const shot = at({ phase: 'playing', logLength: 1, lastShot: { outcome: 'miss' } });
    expect(soundsForTransition(shot, shot)).toEqual([]);
  });
});

describe('turn cue', () => {
  it('plays when the game starts on the human turn', () => {
    const next = at({ phase: 'playing' });
    expect(ids(soundsForTransition(base, next))).toEqual(['yourTurn']);
  });

  it('plays when the turn comes back from the bot', () => {
    const botTurn = at({ phase: 'playing', awaitingBot: true, logLength: 1 });
    const back = at({
      phase: 'playing',
      awaitingBot: false,
      logLength: 2,
      lastShot: { outcome: 'miss' },
    });

    const sounds = soundsForTransition(botTurn, back);
    expect(ids(sounds)).toEqual(['fire', 'miss', 'yourTurn']);
    expect(sounds.at(-1)?.delayMs).toBe(TURN_CUE_DELAY_MS);
  });

  it('stays silent while the human keeps the turn after a hit', () => {
    const first = at({ phase: 'playing', logLength: 1, lastShot: { outcome: 'hit' } });
    const second = at({ phase: 'playing', logLength: 2, lastShot: { outcome: 'hit' } });

    expect(ids(soundsForTransition(first, second))).toEqual(['fire', 'hit']);
  });

  it('stays silent when the turn passes to the bot', () => {
    const mine = at({ phase: 'playing' });
    const theirs = at({
      phase: 'playing',
      awaitingBot: true,
      logLength: 1,
      lastShot: { outcome: 'miss' },
    });

    expect(ids(soundsForTransition(mine, theirs))).toEqual(['fire', 'miss']);
  });
});

describe('end of game', () => {
  it('plays victory after the final impact', () => {
    const before = at({ phase: 'playing', logLength: 5 });
    const won = at({
      phase: 'finished',
      logLength: 6,
      lastShot: { outcome: 'sunk' },
      humanWon: true,
    });

    const sounds = soundsForTransition(before, won);
    expect(ids(sounds)).toEqual(['fire', 'sink', 'victory']);
    expect(sounds.at(-1)?.delayMs).toBe(RESULT_DELAY_MS);
    expect(RESULT_DELAY_MS).toBeGreaterThan(IMPACT_DELAY_MS);
  });

  it('plays defeat when the bot wins', () => {
    const before = at({ phase: 'playing', awaitingBot: true, logLength: 5 });
    const lost = at({
      phase: 'finished',
      logLength: 6,
      lastShot: { outcome: 'sunk' },
      humanLost: true,
    });

    expect(ids(soundsForTransition(before, lost))).toEqual(['fire', 'sink', 'defeat']);
  });

  it('never plays a turn cue alongside the result', () => {
    const before = at({ phase: 'playing', awaitingBot: true });
    const won = at({ phase: 'finished', humanWon: true });

    expect(ids(soundsForTransition(before, won))).toEqual(['victory']);
  });

  it('plays nothing more once the game is already over', () => {
    const finished = at({ phase: 'finished', humanWon: true });
    expect(soundsForTransition(finished, finished)).toEqual([]);
  });
});
