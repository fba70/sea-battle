import { authClient } from './auth-client';

export type GuestSessionOutcome =
  | { status: 'existing'; userId: string }
  | { status: 'created'; userId: string }
  | { status: 'unavailable'; reason: string };

/**
 * Shared by concurrent callers so only one anonymous user is ever minted.
 *
 * Several components now need a session before their first request (the room lobby,
 * the room page, the queue, the ticket fetch), and React StrictMode mounts each of
 * them twice in development. Without this, two callers both saw "no session", both
 * called `signIn.anonymous()`, and the second sign-in replaced the first one's cookie
 * — so a room seat claimed by the first identity came back as "room full" to the
 * second. One in-flight promise makes the whole page agree on one guest.
 */
let inFlight: Promise<GuestSessionOutcome> | null = null;

/**
 * The identity this page settled on.
 *
 * Single-flight alone was not enough: several components call this, and two
 * *sequential* calls could each find no session — the second starting before the
 * first one's cookie was visible to the auth client — and mint a second guest. The
 * second sign-in then replaced the first one's cookie, so a player who had already
 * been queued or seated silently became someone else. Caching the settled identity
 * means at most one guest is ever created per page.
 *
 * Only a real identity is cached; an unavailable backend stays retryable.
 */
let established: GuestSessionOutcome | null = null;

/**
 * Ensures the visitor has a session, creating an anonymous one if they do not.
 *
 * Spec §7.5 / §13 Phase 0: a guest session on first visit so play works with
 * zero signup. Deliberately fail-soft — the Phase 0 bot game runs entirely in
 * the browser and must stay playable when the database or auth service is
 * unreachable, so every failure resolves to `unavailable` rather than throwing.
 */
export function ensureGuestSession(
  client: Pick<typeof authClient, 'getSession' | 'signIn'> = authClient,
): Promise<GuestSessionOutcome> {
  if (established) {
    return Promise.resolve(established);
  }

  inFlight ??= resolveGuestSession(client)
    .then((outcome) => {
      if (outcome.status !== 'unavailable') {
        established = outcome;
      }
      return outcome;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Forgets the settled identity. Test-only: the memo is per page in the browser, and
 * a test file is one module instance shared by every case in it.
 */
export function resetGuestSession(): void {
  established = null;
  inFlight = null;
}

async function resolveGuestSession(
  client: Pick<typeof authClient, 'getSession' | 'signIn'>,
): Promise<GuestSessionOutcome> {
  try {
    const existing = await client.getSession();
    const existingUserId = existing?.data?.user?.id;
    if (existingUserId) {
      return { status: 'existing', userId: existingUserId };
    }

    const created = await client.signIn.anonymous();
    const createdUserId = created?.data?.user?.id;
    if (createdUserId) {
      return { status: 'created', userId: createdUserId };
    }

    return {
      status: 'unavailable',
      reason: created?.error?.message ?? 'anonymous sign-in returned no user',
    };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'unknown error',
    };
  }
}
