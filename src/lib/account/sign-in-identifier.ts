import { displayNameKey } from './display-name';

/**
 * Signing in with either an email address or a display name (spec §7.5).
 *
 * One field, one endpoint: whatever is typed is turned into the address
 * better-auth's email sign-in expects, and everything after that — password
 * verification, rate limiting, the guest claim, the error it returns — is
 * unchanged.
 *
 * The two cannot be confused. A display name is letters, digits and underscores
 * only (see `display-name.ts`), so an "@" means an address and nothing else.
 */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes('@');
}

/**
 * A syntactically valid address that cannot belong to anyone.
 *
 * SECURITY: an unknown username must be indistinguishable from a wrong password.
 * Rather than answering early — which would both leak that the name is free and
 * return faster than a real attempt — the unknown name is turned into this, and
 * better-auth produces its own "invalid email or password" after doing the same
 * password hashing it does for an unknown address. One code path, one answer, one
 * timing profile.
 *
 * `.invalid` is reserved by RFC 2606 and can never be registered; the random
 * local part means it cannot collide with an address somebody did sign up with.
 */
export function unresolvableEmail(): string {
  return `${crypto.randomUUID()}@username.invalid`;
}

/** Looks up the address behind a display name. Case is folded as everywhere else. */
export type EmailLookup = (nameKey: string) => Promise<string | null>;

/** The address to hand to better-auth for what somebody typed. */
export async function resolveSignInEmail(identifier: string, lookup: EmailLookup): Promise<string> {
  const typed = identifier.trim();

  if (looksLikeEmail(typed)) {
    return typed;
  }

  return (await lookup(displayNameKey(typed))) ?? unresolvableEmail();
}
