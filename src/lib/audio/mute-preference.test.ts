import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MUTED,
  MUTE_STORAGE_KEY,
  readMutePreference,
  writeMutePreference,
  type StorageLike,
} from './mute-preference';
import {
  getMutedSnapshot,
  getServerMutedSnapshot,
  resetMuteStore,
  setMuted,
  subscribeToMuted,
} from './mute-store';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwingStorage: StorageLike = {
  getItem() {
    throw new Error('storage blocked');
  },
  setItem() {
    throw new Error('quota exceeded');
  },
};

describe('mute preference persistence', () => {
  it('defaults to unmuted when nothing is stored', () => {
    expect(readMutePreference(fakeStorage())).toBe(DEFAULT_MUTED);
    expect(DEFAULT_MUTED).toBe(false);
  });

  it('round-trips a muted preference', () => {
    const storage = fakeStorage();
    writeMutePreference(true, storage);

    expect(storage.data[MUTE_STORAGE_KEY]).toBe('true');
    expect(readMutePreference(storage)).toBe(true);
  });

  it('round-trips an unmuted preference', () => {
    const storage = fakeStorage({ [MUTE_STORAGE_KEY]: 'true' });
    writeMutePreference(false, storage);

    expect(readMutePreference(storage)).toBe(false);
  });

  it('survives a reload — a fresh read sees the stored value', () => {
    const storage = fakeStorage();
    writeMutePreference(true, storage);

    // Simulates a new page load reading the same origin's storage.
    expect(readMutePreference(fakeStorage(storage.data))).toBe(true);
  });

  it('ignores a corrupted value rather than throwing', () => {
    expect(readMutePreference(fakeStorage({ [MUTE_STORAGE_KEY]: 'banana' }))).toBe(DEFAULT_MUTED);
  });

  it('tolerates storage that throws on read and write', () => {
    expect(() => writeMutePreference(true, throwingStorage)).not.toThrow();
    expect(readMutePreference(throwingStorage)).toBe(DEFAULT_MUTED);
  });

  it('tolerates storage being entirely unavailable', () => {
    expect(() => writeMutePreference(true, null)).not.toThrow();
    expect(readMutePreference(null)).toBe(DEFAULT_MUTED);
  });
});

describe('mute store', () => {
  beforeEach(() => {
    resetMuteStore();
  });

  it('reports unmuted on the server so hydration matches', () => {
    expect(getServerMutedSnapshot()).toBe(false);
  });

  it('notifies subscribers when the preference changes', () => {
    let notifications = 0;
    const unsubscribe = subscribeToMuted(() => {
      notifications += 1;
    });

    setMuted(true);
    expect(notifications).toBe(1);
    expect(getMutedSnapshot()).toBe(true);

    unsubscribe();
    setMuted(false);
    expect(notifications).toBe(1);
  });

  it('does not notify when the value is unchanged', () => {
    let notifications = 0;
    subscribeToMuted(() => {
      notifications += 1;
    });

    setMuted(true);
    setMuted(true);

    expect(notifications).toBe(1);
  });
});
