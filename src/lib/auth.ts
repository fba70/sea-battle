import { APIError, betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { anonymous } from 'better-auth/plugins';

import { runGuestClaim, type GuestClaimStore } from './account/claim';
import { createGuestClaimStore } from './account/claim-store';
import { checkDisplayName, displayNameKey } from './account/display-name';
import { createDisplayNameRegistry, type DisplayNameRegistry } from './account/name-registry';
import { db, schema } from './db';
import { MIN_PASSWORD_LENGTH } from './auth-rules';
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
  claimStore: GuestClaimStore = createGuestClaimStore(),
  nameRegistry: DisplayNameRegistry = createDisplayNameRegistry(),
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
    emailAndPassword: {
      enabled: true,
      // Agreed: length only. Composition rules push people towards worse passwords
      // they have to write down, and better-auth hashes with scrypt either way.
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },

    /**
     * Display names are checked here, at the one place every account creation
     * passes through — rather than in a route handler, which the anonymous plugin
     * and any future sign-up path would bypass.
     *
     * Guests are exempt: better-auth names every one of them "Anonymous", which is
     * both reserved and duplicated, and they hold no place in the namespace.
     */
    databaseHooks: {
      user: {
        create: {
          before: async (candidate: { name?: string; isAnonymous?: boolean | null }) => {
            if (candidate.isAnonymous === true) {
              return;
            }

            const checked = checkDisplayName(candidate.name ?? '');
            if (!checked.ok) {
              throw new APIError('UNPROCESSABLE_ENTITY', {
                code: 'INVALID_DISPLAY_NAME',
                message: checked.problem,
              });
            }

            if (await nameRegistry.isTaken(displayNameKey(checked.name))) {
              throw new APIError('UNPROCESSABLE_ENTITY', {
                code: 'DISPLAY_NAME_TAKEN',
                message: 'taken',
              });
            }

            // Stored trimmed, so what is shown is what uniqueness was judged on.
            return { data: { ...candidate, name: checked.name } };
          },
        },
      },
    },

    plugins: [
      /**
       * Spec §7.5 / §13 Phase 0: "Guest / anonymous session on first visit
       * (better-auth anonymous plugin) so play works with zero signup".
       *
       * The plugin issues a real user row + session cookie with no credentials, and
       * on a later sign-in or sign-up it calls `onLinkAccount` and then deletes the
       * guest row. The registered account is a *new* row with a *new* id, so anything
       * the guest owned has to be re-pointed before that delete — see src/lib/account.
       */
      anonymous({
        /**
         * We delete the guest ourselves, inside the same transaction as the ownership
         * transfer. The plugin's own cleanup runs unconditionally after
         * `onLinkAccount` returns, which would destroy the guest row even when the
         * transfer failed — and `games.player_*_id` is ON DELETE SET NULL, so that
         * would silently detach the history spec §7.5 asks us to preserve.
         *
         * Side effect: this also disables the plugin's `/delete-anonymous-user`
         * endpoint, which the app never calls.
         */
        disableDeleteAnonymousUser: true,

        onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
          // `ctx.path` distinguishes registering (claim the guest) from signing in to
          // an account that already exists (discard it) — spec §7.5. Never throws:
          // the account and its session cookie already exist by this point.
          await runGuestClaim(claimStore, {
            path: ctx.path,
            guest: { id: anonymousUser.user.id, isAnonymous: anonymousUser.user.isAnonymous },
            newUser: { id: newUser.user.id, isAnonymous: newUser.user.isAnonymous },
          });
        },
      }),
      // nextCookies() must stay last in the plugin list.
      nextCookies(),
    ],
  } satisfies BetterAuthOptions;
}

export const auth = betterAuth(buildAuthOptions(drizzleAdapter(db, { provider: 'pg', schema })));

export type Session = typeof auth.$Infer.Session;
