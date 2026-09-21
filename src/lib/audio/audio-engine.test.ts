import { describe, expect, it } from 'vitest';

import {
  createAudioEngine,
  MIN_REPEAT_GAP_MS,
  RETRIGGER_STOP_MS,
  type AudioEngine,
  type HowlLike,
} from './audio-engine';

interface Harness {
  engine: AudioEngine;
  played: string[];
  stopped: number[];
  muteCalls: boolean[];
  howlsCreated: number;
  advance: (ms: number) => void;
  setNow: (ms: number) => void;
}

function harness(options: { failCreate?: boolean; failPlay?: boolean } = {}): Harness {
  const played: string[] = [];
  const stopped: number[] = [];
  const muteCalls: boolean[] = [];
  let howlsCreated = 0;
  let clock = 1000;
  let voice = 0;

  const timers: { at: number; fn: () => void }[] = [];

  const howl: HowlLike = {
    play(sprite) {
      if (options.failPlay) throw new Error('play failed');
      played.push(sprite ?? '');
      voice += 1;
      return voice;
    },
    stop(id) {
      if (id !== undefined) stopped.push(id);
    },
    mute(muted) {
      muteCalls.push(muted);
    },
    unload() {},
  };

  const engine = createAudioEngine({
    createHowl: () => {
      if (options.failCreate) throw new Error('no audio context');
      howlsCreated += 1;
      return howl;
    },
    now: () => clock,
    schedule: (fn, delayMs) => {
      const entry = { at: clock + delayMs, fn };
      timers.push(entry);
      return () => {
        const index = timers.indexOf(entry);
        if (index >= 0) timers.splice(index, 1);
      };
    },
  });

  return {
    engine,
    played,
    stopped,
    muteCalls,
    get howlsCreated() {
      return howlsCreated;
    },
    setNow: (ms) => {
      clock = ms;
    },
    advance: (ms) => {
      clock += ms;
      for (const entry of [...timers]) {
        if (entry.at <= clock) {
          timers.splice(timers.indexOf(entry), 1);
          entry.fn();
        }
      }
    },
  } as Harness;
}

describe('autoplay compliance', () => {
  it('creates no audio context before arming', () => {
    const h = harness();
    h.engine.play('fire');

    expect(h.howlsCreated).toBe(0);
    expect(h.played).toEqual([]);
    expect(h.engine.isArmed()).toBe(false);
  });

  it('plays only after arm() — which callers tie to a user gesture', () => {
    const h = harness();
    h.engine.arm();
    h.engine.play('fire');

    expect(h.engine.isArmed()).toBe(true);
    expect(h.played).toEqual(['fire']);
  });

  it('arms only once no matter how many gestures arrive', () => {
    const h = harness();
    h.engine.arm();
    h.engine.arm();
    h.engine.arm();

    expect(h.howlsCreated).toBe(1);
  });
});

describe('mute', () => {
  it('plays nothing at all while muted', () => {
    const h = harness();
    h.engine.arm();
    h.engine.setMuted(true);

    h.engine.play('fire');
    h.engine.play('hit');
    h.advance(1000);

    expect(h.played).toEqual([]);
  });

  it('also mutes the underlying player, not just the gate', () => {
    const h = harness();
    h.engine.arm();
    h.engine.setMuted(true);

    expect(h.muteCalls).toContain(true);
  });

  it('cancels already-scheduled sounds when muted mid-flight', () => {
    const h = harness();
    h.engine.arm();

    h.engine.play('sink', 200);
    h.engine.setMuted(true);
    h.advance(500);

    expect(h.played).toEqual([]);
  });

  it('resumes playing when unmuted', () => {
    const h = harness();
    h.engine.arm();
    h.engine.setMuted(true);
    h.engine.setMuted(false);
    h.engine.play('hit');

    expect(h.played).toEqual(['hit']);
  });
});

describe('scheduling and overlap control', () => {
  it('delays a sound by the requested amount', () => {
    const h = harness();
    h.engine.arm();

    h.engine.play('hit', 150);
    expect(h.played).toEqual([]);

    h.advance(150);
    expect(h.played).toEqual(['hit']);
  });

  it('collapses two triggers of the same sound fired back to back', () => {
    const h = harness();
    h.engine.arm();

    h.engine.play('hit');
    h.advance(MIN_REPEAT_GAP_MS - 10);
    h.engine.play('hit');

    expect(h.played).toEqual(['hit']);
  });

  it('stops the previous voice when a sound retriggers quickly', () => {
    const h = harness();
    h.engine.arm();

    h.engine.play('miss');
    h.advance(MIN_REPEAT_GAP_MS + 5);
    h.engine.play('miss');

    expect(h.played).toEqual(['miss', 'miss']);
    expect(h.stopped).toEqual([1]);
  });

  it('lets a sound ring out once the retrigger window has passed', () => {
    const h = harness();
    h.engine.arm();

    h.engine.play('miss');
    h.advance(RETRIGGER_STOP_MS + 10);
    h.engine.play('miss');

    expect(h.stopped).toEqual([]);
  });

  it('does not throttle different sounds against each other', () => {
    const h = harness();
    h.engine.arm();

    h.engine.playAll([
      { id: 'fire', delayMs: 0 },
      { id: 'hit', delayMs: 0 },
    ]);

    expect(h.played).toEqual(['fire', 'hit']);
  });
});

describe('failure handling', () => {
  it('degrades to silence when the audio context cannot be created', () => {
    const h = harness({ failCreate: true });

    expect(() => h.engine.arm()).not.toThrow();
    expect(h.engine.isAvailable()).toBe(false);

    expect(() => h.engine.play('fire')).not.toThrow();
    expect(h.played).toEqual([]);
  });

  it('degrades to silence when playback itself throws', () => {
    const h = harness({ failPlay: true });
    h.engine.arm();

    expect(() => h.engine.play('fire')).not.toThrow();
    expect(h.engine.isAvailable()).toBe(false);
  });

  it('stops playing after disposal', () => {
    const h = harness();
    h.engine.arm();
    h.engine.dispose();

    h.engine.play('fire');
    h.advance(500);

    expect(h.played).toEqual([]);
  });

  it('drops pending sounds on disposal', () => {
    const h = harness();
    h.engine.arm();

    h.engine.play('victory', 400);
    h.engine.dispose();
    h.advance(1000);

    expect(h.played).toEqual([]);
  });
});
