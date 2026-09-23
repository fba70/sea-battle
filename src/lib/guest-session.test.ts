import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureGuestSession, resetGuestSession } from './guest-session';

type Client = Parameters<typeof ensureGuestSession>[0];

function client(overrides: { getSession?: () => unknown; anonymous?: () => unknown }): Client {
  return {
    getSession: vi.fn(overrides.getSession ?? (() => ({ data: null }))),
    signIn: { anonymous: vi.fn(overrides.anonymous ?? (() => ({ data: null }))) },
  } as unknown as Client;
}

describe('ensureGuestSession', () => {
  // The settled identity is module state, shared by every case in this file.
  beforeEach(resetGuestSession);

  it('reuses an existing session instead of minting a second guest', async () => {
    const anonymous = vi.fn();
    const result = await ensureGuestSession(
      client({ getSession: () => ({ data: { user: { id: 'guest-1' } } }), anonymous }),
    );

    expect(result).toEqual({ status: 'existing', userId: 'guest-1' });
    expect(anonymous).not.toHaveBeenCalled();
  });

  it('creates a guest when there is no session yet', async () => {
    const result = await ensureGuestSession(
      client({ anonymous: () => ({ data: { user: { id: 'guest-2' } } }) }),
    );

    expect(result).toEqual({ status: 'created', userId: 'guest-2' });
  });

  /**
   * The Phase 0 bot game runs entirely in the browser. A missing database must
   * never stop someone playing, so every failure path resolves rather than throws.
   */
  it('reports unavailable when sign-in returns an error', async () => {
    const result = await ensureGuestSession(
      client({ anonymous: () => ({ data: null, error: { message: 'no database' } }) }),
    );

    expect(result).toEqual({ status: 'unavailable', reason: 'no database' });
  });

  it('never throws when the network call rejects', async () => {
    const result = await ensureGuestSession(
      client({
        getSession: () => {
          throw new Error('fetch failed');
        },
      }),
    );

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toBe('fetch failed');
  });

  it('never throws when the service returns nothing usable', async () => {
    const result = await ensureGuestSession(client({ anonymous: () => undefined }));

    expect(result.status).toBe('unavailable');
  });

  /**
   * The bug this guards: several components now call this before their first request,
   * and React StrictMode mounts each of them twice. Two concurrent callers used to
   * mint two guests, and the second sign-in replaced the first one's cookie — so a
   * room seat claimed by the first identity came back as "room full" to the second.
   */
  it('mints one guest when several callers race, not one each', async () => {
    const anonymous = vi.fn(() => ({ data: { user: { id: 'guest-3' } } }));
    const shared = client({ anonymous });

    const results = await Promise.all([
      ensureGuestSession(shared),
      ensureGuestSession(shared),
      ensureGuestSession(shared),
    ]);

    expect(anonymous).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { status: 'created', userId: 'guest-3' },
      { status: 'created', userId: 'guest-3' },
      { status: 'created', userId: 'guest-3' },
    ]);
  });

  it('never mints a second guest once one is settled, however often it is called', async () => {
    // The failure this prevents: a later call finding no session yet and signing in
    // again, replacing the cookie of a player who was already queued or seated.
    const anonymous = vi.fn(() => ({ data: { user: { id: 'guest-4' } } }));
    const first = client({ anonymous });
    expect(await ensureGuestSession(first)).toEqual({ status: 'created', userId: 'guest-4' });

    // A client that reports no session at all must not trigger a second sign-in.
    const forgetful = client({ getSession: () => ({ data: null }) });
    expect(await ensureGuestSession(forgetful)).toEqual({ status: 'created', userId: 'guest-4' });
    expect(anonymous).toHaveBeenCalledTimes(1);
  });

  it('stays retryable when the backend was unavailable', async () => {
    const failing = client({ anonymous: () => ({ data: null, error: { message: 'down' } }) });
    expect((await ensureGuestSession(failing)).status).toBe('unavailable');

    const recovered = client({ anonymous: () => ({ data: { user: { id: 'guest-5' } } }) });
    expect(await ensureGuestSession(recovered)).toEqual({ status: 'created', userId: 'guest-5' });
  });
});
