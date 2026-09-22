/**
 * Guest → account claim policy (spec §7.5).
 *
 * ## What better-auth actually does
 *
 * The installed anonymous plugin (better-auth 1.7.3) does NOT upgrade the guest row
 * in place. On any sign-in/sign-up that issues a session token, an `after` hook:
 *
 *   1. resolves the *anonymous* session from the request cookie,
 *   2. calls `onLinkAccount({ anonymousUser, newUser, ctx })`,
 *   3. deletes the anonymous user row — unless `disableDeleteAnonymousUser` is set.
 *
 * So the registered identity is a **different user row with a different id**, and the
 * guest row is destroyed. Anything owned by the guest has to be re-pointed inside
 * `onLinkAccount`, before that delete, or it is lost: `games.player_*_id` is
 * `ON DELETE SET NULL`, so the guest's match history would silently detach.
 *
 * We therefore set `disableDeleteAnonymousUser: true` and delete the guest ourselves,
 * in the same transaction as the transfer. If the transfer fails the guest row
 * survives with its data intact, instead of being deleted after a half-done move.
 *
 * ## Security
 *
 * There is no claim endpoint and no client-supplied guest id. The guest identity comes
 * from better-auth's own resolution of the *session cookie*, so "which guest is being
 * converted" is never something a caller can assert. The checks here are defence in
 * depth on top of that.
 */

/** The decision this module makes for one link event. */
export type ClaimAction =
  /** Move the guest's data onto the new account, then delete the guest (spec §7.5). */
  | 'claim'
  /** Spec §7.5 "already have an account": drop the throwaway guest, transfer nothing. */
  | 'discard'
  /** Do nothing at all — the event is not a guest conversion. */
  | 'skip';

export type ClaimReason =
  | 'registered'
  | 'signed_in_to_existing_account'
  | 'guest_not_anonymous'
  | 'same_identity'
  | 'new_identity_is_anonymous'
  | 'missing_identity';

export interface ClaimDecision {
  readonly action: ClaimAction;
  readonly reason: ClaimReason;
}

export interface LinkedIdentity {
  readonly id: string;
  readonly isAnonymous?: boolean | null;
}

export interface ClaimInput {
  /** The better-auth route that triggered the link, e.g. `/sign-up/email`. */
  readonly path: string | undefined;
  readonly guest: LinkedIdentity;
  readonly newUser: LinkedIdentity;
}

export interface ClaimCounts {
  /** Rows in `games` whose seat or winner reference moved to the new account. */
  readonly games: number;
  /** False when the guest was already gone — a replayed link event. */
  readonly guestExisted: boolean;
}

export interface GuestClaimStore {
  /**
   * Moves every reference from `guestUserId` to `userId`, adopts the guest's profile
   * into empty fields, records the claim, and removes the guest — atomically.
   * Must be idempotent: a second call for the same pair transfers nothing.
   */
  claim(input: { guestUserId: string; userId: string }): Promise<ClaimCounts>;
  /** Removes the throwaway guest without transferring anything. */
  discard(input: { guestUserId: string }): Promise<void>;
}

/** Structured, non-sensitive record of what happened. */
export interface ClaimOutcome extends ClaimDecision {
  readonly guestUserId: string;
  readonly userId: string;
  readonly games: number;
  readonly failed: boolean;
}

export interface ClaimLogger {
  info(message: string, detail: Record<string, unknown>): void;
  error(message: string, detail: Record<string, unknown>): void;
}

/** Paths that create a brand-new identity. Everything else is an existing login. */
const REGISTRATION_PATH_PREFIX = '/sign-up';

/**
 * Decides what a link event means. Pure — no I/O, so every branch is directly testable.
 *
 * The guards mirror invariants the plugin already enforces (`resolveAnonymousSession`
 * only returns users with `isAnonymous`, and the caller skips when the ids match). They
 * are repeated here because this function is the last thing standing between a link
 * event and a destructive ownership transfer.
 */
export function decideClaim(input: ClaimInput): ClaimDecision {
  const { path, guest, newUser } = input;

  if (!guest.id || !newUser.id) {
    return { action: 'skip', reason: 'missing_identity' };
  }

  // A registered identity must never be treated as a claimable guest.
  if (guest.isAnonymous !== true) {
    return { action: 'skip', reason: 'guest_not_anonymous' };
  }

  // Nothing to transfer, and deleting here would delete the signed-in user.
  if (guest.id === newUser.id) {
    return { action: 'skip', reason: 'same_identity' };
  }

  // A guest landing on another anonymous identity is not a conversion.
  if (newUser.isAnonymous === true) {
    return { action: 'skip', reason: 'new_identity_is_anonymous' };
  }

  if (path?.startsWith(REGISTRATION_PATH_PREFIX) === true) {
    return { action: 'claim', reason: 'registered' };
  }

  // Spec §7.5: "Handle the 'already have an account' path by logging in and discarding
  // the throwaway guest." Signing in proves ownership of the *existing* account, but it
  // is deliberately not a merge — two registered identities are never combined, and a
  // guest's history is never moved onto an account just because someone logged into it.
  return { action: 'discard', reason: 'signed_in_to_existing_account' };
}

/**
 * Applies a claim decision.
 *
 * Never throws. The plugin calls this *after* the account already exists and the
 * session cookie is already on the response, so throwing would turn a completed
 * registration into an error response without undoing it. A failure here leaves the
 * guest row untouched (we disabled the plugin's own delete), so nothing is lost and
 * the data can still be recovered.
 */
export async function runGuestClaim(
  store: GuestClaimStore,
  input: ClaimInput,
  logger: ClaimLogger = console,
): Promise<ClaimOutcome> {
  const decision = decideClaim(input);
  const identities = { guestUserId: input.guest.id, userId: input.newUser.id };

  if (decision.action === 'skip') {
    logger.info('guest claim skipped', { ...identities, reason: decision.reason });
    return { ...decision, ...identities, games: 0, failed: false };
  }

  try {
    if (decision.action === 'discard') {
      await store.discard({ guestUserId: input.guest.id });
      logger.info('guest discarded', { ...identities, reason: decision.reason });
      return { ...decision, ...identities, games: 0, failed: false };
    }

    const counts = await store.claim({
      guestUserId: input.guest.id,
      userId: input.newUser.id,
    });

    logger.info('guest claimed', {
      ...identities,
      reason: decision.reason,
      games: counts.games,
      // False on a replayed link event: the guest was already claimed and removed.
      guestExisted: counts.guestExisted,
    });

    return { ...decision, ...identities, games: counts.games, failed: false };
  } catch (error) {
    // Deliberately narrow: identities and a message, never the session, its token,
    // the email or anything else carried on the auth context.
    logger.error('guest claim failed; guest data left intact', {
      ...identities,
      action: decision.action,
      message: error instanceof Error ? error.message : 'unknown error',
    });
    return { ...decision, ...identities, games: 0, failed: true };
  }
}
