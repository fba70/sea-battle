/**
 * Rules shared by the auth configuration and the sign-up form.
 *
 * Separate from `auth.ts` because that module pulls in the database adapter and the
 * whole better-auth server; a client component only needs the number.
 */

/** Minimum password length (agreed product rule; no composition requirements). */
export const MIN_PASSWORD_LENGTH = 8;
