'use client';

import { Howl } from 'howler';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { createAudioEngine, type AudioEngine, type HowlLike } from './audio-engine';
import {
  getMutedSnapshot,
  getServerMutedSnapshot,
  setMuted as persistMuted,
  subscribeToMuted,
} from './mute-store';
import type { ScheduledSound } from './sound-map';
import type { SoundId } from './sprite.generated';

export interface AudioApi {
  readonly muted: boolean;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  play: (id: SoundId, delayMs?: number) => void;
  playAll: (sounds: readonly ScheduledSound[]) => void;
}

const NOOP_AUDIO: AudioApi = {
  muted: false,
  setMuted: () => {},
  toggleMuted: () => {},
  play: () => {},
  playAll: () => {},
};

const AudioContext = createContext<AudioApi | null>(null);

/**
 * Owns the single audio engine for the app.
 *
 * The engine is created on the first real user gesture and never before, which
 * is what keeps us on the right side of browser autoplay policy (spec §7.2).
 */
export function SoundProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<AudioEngine | null>(null);

  const muted = useSyncExternalStore(subscribeToMuted, getMutedSnapshot, getServerMutedSnapshot);

  const getEngine = useCallback(() => {
    if (!engineRef.current) {
      engineRef.current = createAudioEngine({
        createHowl: (config) => new Howl(config) as HowlLike,
      });
    }
    return engineRef.current;
  }, []);

  // Arm on the first interaction of any kind, then stop listening.
  useEffect(() => {
    const onGesture = () => {
      const engine = getEngine();
      engine.arm();
      engine.setMuted(getMutedSnapshot());
    };

    const options = { once: true, passive: true } as const;
    window.addEventListener('pointerdown', onGesture, options);
    window.addEventListener('keydown', onGesture, options);
    window.addEventListener('touchstart', onGesture, options);

    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      window.removeEventListener('touchstart', onGesture);
    };
  }, [getEngine]);

  useEffect(() => {
    engineRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(
    () => () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    },
    [],
  );

  const api = useMemo<AudioApi>(
    () => ({
      muted,
      setMuted: persistMuted,
      toggleMuted: () => persistMuted(!getMutedSnapshot()),
      play: (id, delayMs) => engineRef.current?.play(id, delayMs),
      playAll: (sounds) => engineRef.current?.playAll(sounds),
    }),
    [muted],
  );

  return <AudioContext.Provider value={api}>{children}</AudioContext.Provider>;
}

/** Safe outside a provider: audio simply becomes a no-op. */
export function useSound(): AudioApi {
  return useContext(AudioContext) ?? NOOP_AUDIO;
}
