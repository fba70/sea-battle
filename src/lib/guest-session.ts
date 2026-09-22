import { authClient } from './auth-client';

export type GuestSessionOutcome =
  | { status: 'existing'; userId: string }
  | { status: 'created'; userId: string }
  | { status: 'unavailable'; reason: string };

/**
 * Ensures the visitor has a session, creating an anonymous one if they do not.
 *
 * Spec §7.5 / §13 Phase 0: a guest session on first visit so play works with
 * zero signup. Deliberately fail-soft — the Phase 0 bot game runs entirely in
 * the browser and must stay playable when the database or auth service is
 * unreachable, so every failure resolves to `unavailable` rather than throwing.
 */
export async function ensureGuestSession(
  client: Pick<typeof authClient, 'getSession' | 'signIn'> = authClient,
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
