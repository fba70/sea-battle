import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ClaimCounts, GuestClaimStore } from './account/claim';
import { buildAuthOptions } from './auth';

/**
 * Exercises the real auth configuration — the same `buildAuthOptions` production
 * uses — against an in-memory store, so the anonymous-guest behaviour required by
 * spec §7.5 is verified without needing a database.
 */
type Store = Record<string, unknown[]>;

interface ClaimCall {
  readonly kind: 'claim' | 'discard';
  readonly guestUserId: string;
  readonly userId?: string;
}

/**
 * Stands in for the Neon-backed claim store. The memory adapter has no `games`
 * table, so the ownership transfer itself is covered by claim-store.test.ts; what
 * these tests prove is that better-auth calls us at all, with which identities, and
 * what it does to the rows afterwards.
 */
function recordingClaimStore(counts: ClaimCounts = { games: 2, guestExisted: true }) {
  const calls: ClaimCall[] = [];
  const store: GuestClaimStore = {
    claim: async ({ guestUserId, userId }) => {
      calls.push({ kind: 'claim', guestUserId, userId });
      return counts;
    },
    discard: async ({ guestUserId }) => {
      calls.push({ kind: 'discard', guestUserId });
    },
  };
  return { store, calls };
}

function freshAuth(claimStore: GuestClaimStore = recordingClaimStore().store) {
  const store: Store = { user: [], session: [], account: [], verification: [] };

  /** The same uniqueness rule as the Postgres index, over the in-memory rows. */
  const nameRegistry = {
    isTaken: async (key: string) =>
      (store.user as { name?: string; isAnonymous?: boolean }[]).some(
        (row) => row.isAnonymous !== true && (row.name ?? '').toLowerCase() === key,
      ),
  };

  const auth = betterAuth(
    buildAuthOptions(memoryAdapter(store), 'http://localhost:3000', claimStore, nameRegistry),
  );
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

describe('guest → account claim (spec §7.5)', () => {
  const PASSWORD = 'a-long-enough-password';

  /** Signs in anonymously and returns the guest id plus its session cookie. */
  async function asGuest(auth: ReturnType<typeof freshAuth>['auth']) {
    const { response, headers } = await auth.api.signInAnonymous({ returnHeaders: true });
    const cookie = headers.get('set-cookie');
    if (!response?.user?.id || !cookie) {
      throw new Error('guest sign-in did not produce a session');
    }
    return { guestId: response.user.id, headers: new Headers({ cookie }) };
  }

  it('links the guest to the new account when that guest registers', async () => {
    const recorder = recordingClaimStore();
    const { auth } = freshAuth(recorder.store);
    const guest = await asGuest(auth);

    const { response } = await auth.api.signUpEmail({
      body: { email: 'new@example.com', password: PASSWORD, name: 'New_Player' },
      headers: guest.headers,
      returnHeaders: true,
    });

    expect(recorder.calls).toEqual([
      { kind: 'claim', guestUserId: guest.guestId, userId: response?.user?.id },
    ]);
  });

  it('creates a separate registered row rather than upgrading the guest in place', async () => {
    // The installed plugin does not convert the row — knowing which model we are in
    // is the whole reason the ownership transfer exists.
    const recorder = recordingClaimStore();
    const { auth } = freshAuth(recorder.store);
    const guest = await asGuest(auth);

    const { response } = await auth.api.signUpEmail({
      body: { email: 'new@example.com', password: PASSWORD, name: 'New_Player' },
      headers: guest.headers,
      returnHeaders: true,
    });

    expect(response?.user?.id).toBeTruthy();
    expect(response?.user?.id).not.toBe(guest.guestId);
  });

  it('leaves the new account non-anonymous, so it can hold a rating', async () => {
    // Block 2 refuses a ratings row for an anonymous user. The converted identity
    // must therefore come out with is_anonymous false.
    const recorder = recordingClaimStore();
    const { auth, store } = freshAuth(recorder.store);
    const guest = await asGuest(auth);

    const { response } = await auth.api.signUpEmail({
      body: { email: 'new@example.com', password: PASSWORD, name: 'New_Player' },
      headers: guest.headers,
      returnHeaders: true,
    });

    const users = store.user as { id: string; isAnonymous?: boolean }[];
    const registered = users.find((row) => row.id === response?.user?.id);
    expect(registered).toBeDefined();
    expect(registered?.isAnonymous).toBeFalsy();
  });

  it('issues a fresh session for the account instead of reusing the guest session', async () => {
    const recorder = recordingClaimStore();
    const { auth } = freshAuth(recorder.store);
    const guest = await asGuest(auth);

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'new@example.com', password: PASSWORD, name: 'New_Player' },
      headers: guest.headers,
      returnHeaders: true,
    });

    const newCookie = headers.get('set-cookie');
    expect(newCookie).toBeTruthy();

    // The caller ends up authenticated as the registered account, not still a guest.
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: newCookie as string }),
    });
    expect(session?.user.id).not.toBe(guest.guestId);
    expect(session?.user.isAnonymous).toBeFalsy();
  });

  it('discards the guest when it signs in to an account that already exists', async () => {
    // Spec §7.5: log in and discard the throwaway guest — never merge.
    const recorder = recordingClaimStore();
    const { auth } = freshAuth(recorder.store);

    await auth.api.signUpEmail({
      body: { email: 'existing@example.com', password: PASSWORD, name: 'Existing' },
    });
    recorder.calls.length = 0;

    const guest = await asGuest(auth);
    await auth.api.signInEmail({
      body: { email: 'existing@example.com', password: PASSWORD },
      headers: guest.headers,
    });

    expect(recorder.calls).toEqual([{ kind: 'discard', guestUserId: guest.guestId }]);
  });

  it('does not move a guest onto an existing account just because someone logged in', async () => {
    const recorder = recordingClaimStore();
    const { auth } = freshAuth(recorder.store);

    await auth.api.signUpEmail({
      body: { email: 'existing@example.com', password: PASSWORD, name: 'Existing' },
    });
    recorder.calls.length = 0;

    const guest = await asGuest(auth);
    await auth.api.signInEmail({
      body: { email: 'existing@example.com', password: PASSWORD },
      headers: guest.headers,
    });

    expect(recorder.calls.some((call) => call.kind === 'claim')).toBe(false);
  });

  it('claims nothing when registration fails on a duplicate email', async () => {
    const recorder = recordingClaimStore();
    const { auth } = freshAuth(recorder.store);

    await auth.api.signUpEmail({
      body: { email: 'taken@example.com', password: PASSWORD, name: 'First' },
    });
    recorder.calls.length = 0;

    const guest = await asGuest(auth);
    await auth.api
      .signUpEmail({
        body: { email: 'taken@example.com', password: PASSWORD, name: 'Second' },
        headers: guest.headers,
      })
      .catch(() => undefined);

    // No account was created, so nothing may be transferred anywhere.
    expect(recorder.calls).toEqual([]);
  });

  it('does nothing at all when a registration carries no guest session', async () => {
    const recorder = recordingClaimStore();
    const { auth } = freshAuth(recorder.store);

    await auth.api.signUpEmail({
      body: { email: 'direct@example.com', password: PASSWORD, name: 'Direct' },
    });

    expect(recorder.calls).toEqual([]);
  });

  it('does not fire again when the same account signs in a second time', async () => {
    // A repeated sign-in with no guest cookie must not re-run a transfer.
    const recorder = recordingClaimStore();
    const { auth } = freshAuth(recorder.store);
    const guest = await asGuest(auth);

    await auth.api.signUpEmail({
      body: { email: 'new@example.com', password: PASSWORD, name: 'New_Player' },
      headers: guest.headers,
    });
    expect(recorder.calls).toHaveLength(1);

    await auth.api.signInEmail({ body: { email: 'new@example.com', password: PASSWORD } });
    expect(recorder.calls).toHaveLength(1);
  });

  it('keeps the guest row when the transfer fails, so nothing is lost', async () => {
    // We disabled the plugin's own delete precisely so a failed claim is recoverable.
    const failing: GuestClaimStore = {
      claim: async () => {
        throw new Error('database unavailable');
      },
      discard: async () => {},
    };
    const { auth, store } = freshAuth(failing);
    const guest = await asGuest(auth);

    const { response } = await auth.api.signUpEmail({
      body: { email: 'new@example.com', password: PASSWORD, name: 'New_Player' },
      headers: guest.headers,
      returnHeaders: true,
    });

    // Registration still succeeded...
    expect(response?.user?.id).toBeTruthy();
    // ...and the guest survives for a retry rather than being deleted half-migrated.
    const users = store.user as { id: string }[];
    expect(users.some((row) => row.id === guest.guestId)).toBe(true);
  });

  it('never lets a guest sign in anonymously twice', async () => {
    const { auth } = freshAuth();
    const guest = await asGuest(auth);

    await expect(auth.api.signInAnonymous({ headers: guest.headers })).rejects.toBeTruthy();
  });
});

describe('display names (spec §7.5)', () => {
  const PASSWORD_8 = 'eightchr';

  async function register(
    auth: ReturnType<typeof freshAuth>['auth'],
    name: string,
    email = `${name.toLowerCase()}@example.com`,
    password = PASSWORD_8,
  ) {
    return auth.api.signUpEmail({ body: { email, password, name } });
  }

  it('refuses a name that breaks the agreed rules', async () => {
    const { auth } = freshAuth();

    await expect(register(auth, 'ab')).rejects.toThrow();
    await expect(register(auth, 'has space', 'spaced@example.com')).rejects.toThrow();
    await expect(register(auth, 'Anonymous', 'imposter@example.com')).rejects.toThrow();
  });

  it('refuses a name already taken, whatever the casing', async () => {
    const { auth } = freshAuth();
    await register(auth, 'Mariner');

    // Case-insensitive uniqueness: the second registration must not succeed.
    await expect(register(auth, 'MARINER', 'other@example.com')).rejects.toThrow();
  });

  it('stores the name trimmed, so it matches what uniqueness was judged on', async () => {
    const { auth, store } = freshAuth();
    await register(auth, '  Harbour  ', 'harbour@example.com');

    const rows = store.user as { name?: string; isAnonymous?: boolean }[];
    expect(rows.find((row) => row.isAnonymous !== true)?.name).toBe('Harbour');
  });

  it('leaves guests alone, because every one of them is called Anonymous', async () => {
    // A global rule would make the second guest impossible, and guests are how the
    // game is played without an account at all.
    const { auth, store } = freshAuth();
    await signInAnonymously(auth);
    await signInAnonymously(auth);

    const guests = (store.user as { isAnonymous?: boolean }[]).filter(
      (row) => row.isAnonymous === true,
    );
    expect(guests).toHaveLength(2);
  });

  it('accepts a password of exactly the agreed minimum', async () => {
    const { auth } = freshAuth();
    await expect(
      register(auth, 'Keelson', 'keelson@example.com', PASSWORD_8),
    ).resolves.toBeTruthy();
  });

  it('refuses a password one character short', async () => {
    const { auth } = freshAuth();
    await expect(register(auth, 'Rudder', 'rudder@example.com', 'sevench')).rejects.toThrow();
  });
});
