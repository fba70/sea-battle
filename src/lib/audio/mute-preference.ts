export const MUTE_STORAGE_KEY = 'seaduel:sound-muted';

/** The slice of the Storage API we actually use, so tests can supply a stub. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    // Throws in some privacy modes rather than simply being absent.
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Sound is ON by default (spec §7.2 only calls for the *ambient loop* to default
 * off). Nothing is audible until the first user gesture regardless, so this does
 * not breach the autoplay policy.
 */
export const DEFAULT_MUTED = false;

export function readMutePreference(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return DEFAULT_MUTED;

  try {
    const raw = storage.getItem(MUTE_STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return DEFAULT_MUTED;
  } catch {
    // Storage can throw on access even when it exists; never let that break audio.
    return DEFAULT_MUTED;
  }
}

export function writeMutePreference(
  muted: boolean,
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage) return;

  try {
    storage.setItem(MUTE_STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    // Quota or a blocked store — the preference just will not survive reload.
  }
}
