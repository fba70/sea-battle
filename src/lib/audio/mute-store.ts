import { readMutePreference, writeMutePreference } from './mute-preference';

/**
 * A tiny external store so React can read the persisted mute flag through
 * `useSyncExternalStore` — which reads it during render without an effect, and
 * without a hydration mismatch (the server always reports "not muted").
 */
let current: boolean | null = null;
const listeners = new Set<() => void>();

export function getMutedSnapshot(): boolean {
  if (current === null) {
    current = readMutePreference();
  }
  return current;
}

export function getServerMutedSnapshot(): boolean {
  return false;
}

export function setMuted(muted: boolean): void {
  if (current === muted) return;
  current = muted;
  writeMutePreference(muted);
  for (const listener of listeners) listener();
}

export function subscribeToMuted(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget the cached value so a fresh preference is read. */
export function resetMuteStore(): void {
  current = null;
  listeners.clear();
}
