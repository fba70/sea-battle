import { describe, expect, it } from 'vitest';

import type { ShotOutcome } from '@/game/types';
import { soundsForTransition, type AudioSnapshot } from './sound-map';
import { SFX_SPRITE, SFX_SRC, SOUND_IDS } from './sprite.generated';

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

/** Every sound the mapping can emit, across all reachable transitions. */
function everyEmittableSound(): Set<string> {
  const emitted = new Set<string>();
  const outcomes: ShotOutcome[] = ['miss', 'hit', 'sunk'];

  const transitions: [AudioSnapshot, AudioSnapshot][] = [
    [base, { ...base, placedCount: 1 }],
    [base, { ...base, invalidCount: 1 }],
    [base, { ...base, phase: 'playing' }],
    [
      { ...base, phase: 'playing', awaitingBot: true },
      {
        ...base,
        phase: 'playing',
        awaitingBot: false,
        logLength: 1,
        lastShot: { outcome: 'miss' },
      },
    ],
    [
      { ...base, phase: 'playing' },
      { ...base, phase: 'finished', humanWon: true },
    ],
    [
      { ...base, phase: 'playing' },
      { ...base, phase: 'finished', humanLost: true },
    ],
    ...outcomes.map((outcome): [AudioSnapshot, AudioSnapshot] => [
      { ...base, phase: 'playing' },
      { ...base, phase: 'playing', logLength: 1, lastShot: { outcome } },
    ]),
  ];

  for (const [previous, next] of transitions) {
    for (const sound of soundsForTransition(previous, next)) {
      emitted.add(sound.id);
    }
  }
  return emitted;
}

describe('sprite', () => {
  it('points at an asset generated into public/', () => {
    expect(SFX_SRC).toBe('/audio/sfx.wav');
  });

  it('defines a non-empty, non-overlapping region for every sound', () => {
    const regions = SOUND_IDS.map((id) => ({ id, span: SFX_SPRITE[id] })).sort(
      (a, b) => a.span[0] - b.span[0],
    );

    let previousEnd = -1;
    for (const { id, span } of regions) {
      const [start, duration] = span;
      expect(duration, `${id} must have a duration`).toBeGreaterThan(0);
      expect(start, `${id} must start after the previous sound`).toBeGreaterThan(previousEnd);
      previousEnd = start + duration;
    }
  });

  it('keeps every effect short enough not to become tiring', () => {
    for (const id of SOUND_IDS) {
      expect(SFX_SPRITE[id][1], `${id} is too long`).toBeLessThanOrEqual(900);
    }
  });

  /** Guards against the mapping and the generated sprite drifting apart. */
  it('contains every sound the event mapping can emit', () => {
    const emitted = everyEmittableSound();

    expect(emitted.size).toBeGreaterThan(0);
    for (const id of emitted) {
      expect(SOUND_IDS, `${id} is emitted but missing from the sprite`).toContain(id);
    }
  });

  it('covers the full SFX list from spec §7.2 that Phase 0 can trigger', () => {
    // Emoji reactions are the one §7.2 sound with no Phase 0 trigger yet.
    for (const id of [
      'place',
      'invalid',
      'fire',
      'miss',
      'hit',
      'sink',
      'yourTurn',
      'victory',
      'defeat',
      'click',
    ]) {
      expect(SOUND_IDS).toContain(id);
    }
  });
});
