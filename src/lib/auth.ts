import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { anonymous } from 'better-auth/plugins';

import { db, schema } from './db';
import { serverEnv } from './env';

/**
 * The auth configuration, minus the storage adapter.
 *
 * Kept as a builder so production (Drizzle on Neon) and the integration tests
 * (in-memory adapter) exercise exactly the same options — there is one auth
 * configuration, not two that can drift.
 */
export function buildAuthOptions(
  database: BetterAuthOptions['database'],
  baseURL: string = serverEnv.BETTER_AUTH_URL,
) {
  // No explicit return type: inference has to survive so that `betterAuth()`
  // can derive the plugin API (e.g. `api.signInAnonymous`) from these options.
  return {
    database,
    secret: serverEnv.BETTER_AUTH_SECRET,
    baseURL,

    // Spec §7.5: email + password is the registration path. The UI for it is
    // Phase 1; the endpoint existing now costs nothing and keeps the guest ->
    // account claim a single migration away.
    emailAndPassword: { enabled: true },

    plugins: [
      /**
       * Spec §7.5 / §13 Phase 0: "Guest / anonymous session on first visit
       * (better-auth anonymous plugin) so play works with zero signup".
       *
       * The plugin issues a real user row + session cookie with no credentials.
       * `onLinkAccount` is where Phase 1 will migrate guest progress onto the
       * registered account; there is nothing to carry across yet.
       */
      anonymous(),
      // nextCookies() must stay last in the plugin list.
      nextCookies(),
    ],
  } satisfies BetterAuthOptions;
}

export const auth = betterAuth(buildAuthOptions(drizzleAdapter(db, { provider: 'pg', schema })));

export type Session = typeof auth.$Infer.Session;
