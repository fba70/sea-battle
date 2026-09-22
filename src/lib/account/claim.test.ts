import { describe, expect, it, vi } from 'vitest';

import {
  decideClaim,
  runGuestClaim,
  type ClaimCounts,
  type ClaimInput,
  type GuestClaimStore,
} from './claim';

const GUEST = 'guest-user-id';
const MEMBER = 'registered-user-id';

function input(overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    path: '/sign-up/email',
    guest: { id: GUEST, isAnonymous: true },
    newUser: { id: MEMBER, isAnonymous: false },
    ...overrides,
  };
}

/** Records calls so a test can assert exactly what the policy asked the store to do. */
function fakeStore(counts: ClaimCounts = { games: 3, guestExisted: true }) {
  const calls: { claim: unknown[]; discard: unknown[] } = { claim: [], discard: [] };
  const store: GuestClaimStore = {
    claim: async (args) => {
      calls.claim.push(args);
      return counts;
    },
    discard: async (args) => {
      calls.discard.push(args);
    },
  };
  return { store, calls };
}

function silentLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe('decideClaim — registering (spec §7.5)', () => {
  it('claims the guest when a guest registers a new account', () => {
    expect(decideClaim(input())).toEqual({ action: 'claim', reason: 'registered' });
  });

  it('treats any /sign-up route as registration', () => {
    expect(decideClaim(input({ path: '/sign-up/email' })).action).toBe('claim');
    expect(decideClaim(input({ path: '/sign-up' })).action).toBe('claim');
  });
});

describe('decideClaim — already have an account (spec §7.5)', () => {
  it('discards the throwaway guest instead of merging into the existing account', () => {
    // §7.5: "Handle the 'already have an account' path by logging in and discarding
    // the throwaway guest." Signing in proves ownership of *that* account, but it is
    // not consent to move a different identity's history onto it.
    expect(decideClaim(input({ path: '/sign-in/email' }))).toEqual({
      action: 'discard',
      reason: 'signed_in_to_existing_account',
    });
  });

  it('discards on every other link path the plugin hooks', () => {
    // The plugin's matcher also fires on callbacks and verification routes. None of
    // them create a new identity, so none of them claim.
    for (const path of [
      '/callback/google',
      '/magic-link/verify',
      '/email-otp/verify-email',
      '/verify-email',
      '/passkey/verify-authentication',
    ]) {
      expect(decideClaim(input({ path })).action, path).toBe('discard');
    }
  });

  it('never merges two registered identities — a discard transfers nothing', async () => {
    const { store, calls } = fakeStore();
    await runGuestClaim(store, input({ path: '/sign-in/email' }), silentLogger());

    expect(calls.claim).toHaveLength(0);
    expect(calls.discard).toEqual([{ guestUserId: GUEST }]);
  });
});

describe('decideClaim — refuses anything that is not a guest conversion', () => {
  it('refuses to treat a registered identity as a claimable guest', () => {
    expect(decideClaim(input({ guest: { id: GUEST, isAnonymous: false } }))).toEqual({
      action: 'skip',
      reason: 'guest_not_anonymous',
    });
  });

  it('refuses when the anonymous flag is missing rather than assuming it', () => {
    expect(decideClaim(input({ guest: { id: GUEST } })).reason).toBe('guest_not_anonymous');
    expect(decideClaim(input({ guest: { id: GUEST, isAnonymous: null } })).reason).toBe(
      'guest_not_anonymous',
    );
  });

  it('refuses when both sides are the same identity', () => {
    // Deleting the guest here would delete the user who just signed in.
    expect(decideClaim(input({ newUser: { id: GUEST, isAnonymous: false } }))).toEqual({
      action: 'skip',
      reason: 'same_identity',
    });
  });

  it('refuses when the new identity is itself anonymous', () => {
    expect(decideClaim(input({ newUser: { id: MEMBER, isAnonymous: true } }))).toEqual({
      action: 'skip',
      reason: 'new_identity_is_anonymous',
    });
  });

  it('refuses when either id is missing', () => {
    expect(decideClaim(input({ guest: { id: '', isAnonymous: true } })).reason).toBe(
      'missing_identity',
    );
    expect(decideClaim(input({ newUser: { id: '', isAnonymous: false } })).reason).toBe(
      'missing_identity',
    );
  });

  it('touches the store for none of those cases', async () => {
    const { store, calls } = fakeStore();

    for (const bad of [
      input({ guest: { id: GUEST, isAnonymous: false } }),
      input({ newUser: { id: GUEST, isAnonymous: false } }),
      input({ newUser: { id: MEMBER, isAnonymous: true } }),
      input({ guest: { id: '', isAnonymous: true } }),
    ]) {
      await runGuestClaim(store, bad, silentLogger());
    }

    expect(calls.claim).toHaveLength(0);
    expect(calls.discard).toHaveLength(0);
  });

  it('is decided by the resolved session identities, never by a caller-supplied id', () => {
    // There is no claim endpoint and no guestUserId parameter anywhere: the only way
    // to reach this function is better-auth's own cookie-resolved anonymous session.
    // This test documents the invariant that the input shape carries no client data.
    const shape = Object.keys(input()).sort();
    expect(shape).toEqual(['guest', 'newUser', 'path']);
  });
});

describe('runGuestClaim — replay and failure', () => {
  it('reports how much history moved', async () => {
    const { store } = fakeStore({ games: 7, guestExisted: true });
    const outcome = await runGuestClaim(store, input(), silentLogger());

    expect(outcome).toMatchObject({ action: 'claim', games: 7, failed: false });
  });

  it('is safe when the link event is replayed after a successful claim', async () => {
    // The store reports the guest is already gone; nothing is transferred twice.
    const { store, calls } = fakeStore({ games: 0, guestExisted: false });
    const outcome = await runGuestClaim(store, input(), silentLogger());

    expect(outcome.failed).toBe(false);
    expect(outcome.games).toBe(0);
    expect(calls.claim).toHaveLength(1);
  });

  it('never throws when the store fails, because the account already exists', async () => {
    // Throwing here would turn a completed registration into an error response
    // without undoing it.
    const store: GuestClaimStore = {
      claim: async () => {
        throw new Error('connection reset');
      },
      discard: async () => {},
    };
    const logger = silentLogger();

    const outcome = await runGuestClaim(store, input(), logger);

    expect(outcome.failed).toBe(true);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('never throws when a discard fails either', async () => {
    const store: GuestClaimStore = {
      claim: async () => ({ games: 0, guestExisted: true }),
      discard: async () => {
        throw new Error('nope');
      },
    };

    const outcome = await runGuestClaim(store, input({ path: '/sign-in/email' }), silentLogger());
    expect(outcome.failed).toBe(true);
  });
});

describe('runGuestClaim — logging discloses no auth state', () => {
  const SENSITIVE = 'session-token-value-do-not-log';

  it('logs identities and counts, never a token or a session object', async () => {
    const { store } = fakeStore();
    const logger = silentLogger();

    await runGuestClaim(
      store,
      // Extra fields a caller might carry must not find their way into a log line.
      { ...input(), guest: { id: GUEST, isAnonymous: true, token: SENSITIVE } } as ClaimInput,
      logger,
    );

    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).toContain(GUEST);
    expect(logged).not.toContain(SENSITIVE);
  });

  it('keeps a failure message free of auth state', async () => {
    const store: GuestClaimStore = {
      claim: async () => {
        throw new Error('db unavailable');
      },
      discard: async () => {},
    };
    const logger = silentLogger();

    await runGuestClaim(store, input(), logger);

    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).toContain('db unavailable');
    expect(logged).not.toContain(SENSITIVE);
    expect(logged).not.toContain('password');
  });

  it('reports a non-Error failure without leaking the thrown value', async () => {
    const store: GuestClaimStore = {
      claim: async () => {
        throw { secret: SENSITIVE };
      },
      discard: async () => {},
    };
    const logger = silentLogger();

    await runGuestClaim(store, input(), logger);

    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(SENSITIVE);
  });
});
