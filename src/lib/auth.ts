import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';

import { db, schema } from './db';
import { serverEnv } from './env';

/**
 * Minimal better-auth setup: email + password only.
 *
 * Guest/anonymous sessions and the guest -> account claim flow (spec §7.5) are
 * deliberately not wired yet; this exists so that work has a home to land in.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),
  secret: serverEnv.BETTER_AUTH_SECRET,
  baseURL: serverEnv.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  // nextCookies() must stay last in the plugin list.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
