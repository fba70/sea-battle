import { describe, expect, it, vi } from 'vitest';

import { ensureGuestSession } from './guest-session';

type Client = Parameters<typeof ensureGuestSession>[0];

function client(overrides: { getSession?: () => unknown; anonymous?: () => unknown }): Client {
  return {
    getSession: vi.fn(overrides.getSession ?? (() => ({ data: null }))),
    signIn: { anonymous: vi.fn(overrides.anonymous ?? (() => ({ data: null }))) },
  } as unknown as Client;
}

describe('ensureGuestSession', () => {
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
});
