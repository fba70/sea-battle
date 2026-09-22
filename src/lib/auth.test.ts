import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildAuthOptions } from './auth';

/**
 * Exercises the real auth configuration — the same `buildAuthOptions` production
 * uses — against an in-memory store, so the anonymous-guest behaviour required by
 * spec §7.5 is verified without needing a database.
 */
type Store = Record<string, unknown[]>;

function freshAuth() {
  const store: Store = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth(buildAuthOptions(memoryAdapter(store), 'http://localhost:3000'));
  return { auth, store };
}

async function signInAnonymously(auth: ReturnType<typeof freshAuth>['auth']) {
  return auth.api.signInAnonymous({ returnHeaders: true });
}

describe('guest sessions (spec §7.5, §13 Phase 0)', () => {
  let harness: ReturnType<typeof freshAuth>;

  beforeEach(() => {
    harness = freshAuth();
  });

  it('creates a usable session with no credentials at all', async () => {
    const { response } = await signInAnonymously(harness.auth);

    expect(response?.user?.id).toBeTruthy();
    expect(response?.token).toBeTruthy();
  });

  it('marks the guest as anonymous so Phase 1 can tell guests from members', async () => {
    const { response } = await signInAnonymously(harness.auth);
    const stored = harness.store.user as { id: string; isAnonymous?: boolean }[];

    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(response?.user?.id);
    expect(stored[0]?.isAnonymous).toBe(true);
  });

  it('persists the guest, so a refresh resolves to the same identity', async () => {
    const { response, headers } = await signInAnonymously(harness.auth);
    const cookie = headers.get('set-cookie');
    expect(cookie).toBeTruthy();

    const session = await harness.auth.api.getSession({
      headers: new Headers({ cookie: cookie as string }),
    });

    expect(session?.user.id).toBe(response?.user?.id);
    // Still exactly one guest — resuming must not mint a second identity.
    expect(harness.store.user).toHaveLength(1);
  });

  it('gives separate visitors separate guest identities', async () => {
    const first = await signInAnonymously(harness.auth);
    const second = await signInAnonymously(harness.auth);

    expect(first.response?.user?.id).not.toBe(second.response?.user?.id);
    expect(harness.store.user).toHaveLength(2);
  });

  it('keeps email+password registration available for the Phase 1 claim flow', async () => {
    const result = await harness.auth.api.signUpEmail({
      body: { email: 'player@example.com', password: 'a-long-enough-password', name: 'Player' },
    });

    expect(result?.user?.id).toBeTruthy();
    const stored = harness.store.user as { email: string; isAnonymous?: boolean }[];
    expect(stored.some((u) => u.email === 'player@example.com' && !u.isAnonymous)).toBe(true);
  });
});
