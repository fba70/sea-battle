import type { ScheduledSound } from './sound-map';
import { SFX_SPRITE, SFX_SRC, type SoundId } from './sprite.generated';

/** The part of Howler's surface we depend on, so tests can substitute a stub. */
export interface HowlLike {
  play(sprite?: string): number;
  stop(id?: number): void;
  mute(muted: boolean, id?: number): void;
  unload(): void;
}

export interface AudioEngineDeps {
  /** Returns a loaded Howl, or throws/returns null when audio is unavailable. */
  createHowl: (config: {
    src: string[];
    sprite: Record<string, [number, number]>;
    preload: boolean;
    volume: number;
    onloaderror: () => void;
  }) => HowlLike | null;
  now?: () => number;
  schedule?: (fn: () => void, delayMs: number) => () => void;
}

export interface AudioEngine {
  /** Creates the audio context. Must only be called from a user gesture. */
  arm(): void;
  isArmed(): boolean;
  isAvailable(): boolean;
  play(id: SoundId, delayMs?: number): void;
  playAll(sounds: readonly ScheduledSound[]): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

/** Two triggers of the same sound closer than this collapse into one. */
export const MIN_REPEAT_GAP_MS = 55;
/** Retriggering within this window stops the previous voice, so nothing piles up. */
export const RETRIGGER_STOP_MS = 250;

const defaultSchedule = (fn: () => void, delayMs: number) => {
  const handle = setTimeout(fn, delayMs);
  return () => clearTimeout(handle);
};

/**
 * Thin wrapper over a single Howler sprite.
 *
 * Three things it guarantees:
 *  - nothing is constructed or played before `arm()` (autoplay compliance);
 *  - a failure anywhere degrades to silence rather than throwing;
 *  - rapid repeats are throttled and de-duplicated so a burst of hits cannot
 *    stack into noise.
 */
export function createAudioEngine(deps: AudioEngineDeps): AudioEngine {
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? defaultSchedule;

  let howl: HowlLike | null = null;
  let armed = false;
  let available = true;
  let muted = false;
  let disposed = false;

  const lastPlayedAt = new Map<SoundId, number>();
  const lastVoice = new Map<SoundId, number>();
  const pending = new Set<() => void>();

  const arm = () => {
    if (armed || disposed || !available) return;
    armed = true;

    try {
      howl = deps.createHowl({
        src: [SFX_SRC],
        sprite: SFX_SPRITE as unknown as Record<string, [number, number]>,
        preload: true,
        volume: 0.6,
        onloaderror: () => {
          available = false;
          howl = null;
        },
      });

      if (!howl) {
        available = false;
        return;
      }
      howl.mute(muted);
    } catch {
      available = false;
      howl = null;
    }
  };

  const playNow = (id: SoundId) => {
    if (disposed || muted || !available || !howl) return;

    const at = now();
    const previous = lastPlayedAt.get(id);

    if (previous !== undefined && at - previous < MIN_REPEAT_GAP_MS) {
      return;
    }

    if (previous !== undefined && at - previous < RETRIGGER_STOP_MS) {
      const voice = lastVoice.get(id);
      if (voice !== undefined) {
        try {
          howl.stop(voice);
        } catch {
          // A stale voice id is harmless.
        }
      }
    }

    lastPlayedAt.set(id, at);

    try {
      lastVoice.set(id, howl.play(id));
    } catch {
      available = false;
    }
  };

  const play = (id: SoundId, delayMs = 0) => {
    if (disposed || muted || !available || !armed) return;

    if (delayMs <= 0) {
      playNow(id);
      return;
    }

    let cancel: () => void = () => {};
    const run = () => {
      pending.delete(cancel);
      playNow(id);
    };
    cancel = schedule(run, delayMs);
    pending.add(cancel);
  };

  return {
    arm,
    isArmed: () => armed,
    isAvailable: () => available,
    play,
    playAll: (sounds) => {
      for (const sound of sounds) play(sound.id, sound.delayMs);
    },
    setMuted: (next) => {
      muted = next;
      if (next) {
        for (const cancel of pending) cancel();
        pending.clear();
      }
      try {
        howl?.mute(next);
      } catch {
        // Ignore: mute state is also enforced in `play`.
      }
    },
    dispose: () => {
      disposed = true;
      for (const cancel of pending) cancel();
      pending.clear();
      try {
        howl?.unload();
      } catch {
        // Nothing useful to do while tearing down.
      }
      howl = null;
    },
  };
}
