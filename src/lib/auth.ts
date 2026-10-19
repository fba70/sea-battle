import { APIError, betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { anonymous } from 'better-auth/plugins';

import { runGuestClaim, type GuestClaimStore } from './account/claim';
import { createGuestClaimStore } from './account/claim-store';
import { checkDisplayName, displayNameKey } from './account/display-name';
import { createDisplayNameRegistry, type DisplayNameRegistry } from './account/name-registry';
import { resolveSignInEmail } from './account/sign-in-identifier';
import { db, schema } from './db';
import { MIN_PASSWORD_LENGTH } from './auth-rules';
import { passwordResetEmail, sendEmail, verificationEmail } from './email';
import { serverEnv } from './env';
import { localeForEmail } from './email-locale';

/**
 * Points the confirmation link's landing page at our own, in the language the
 * email is written in.
 *
 * better-auth checks the token on its own endpoint and then redirects to
 * whatever `callbackURL` carries — "/" by default, which would drop someone on
 * the home page with no idea whether it worked. Only that parameter is touched;
 * the token is left exactly as issued.
 */
function landingFor(url: string, locale: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('callbackURL', `/${locale}/account/verified`);
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Spec §7.5: short-lived by design. An hour is better-auth's own default. */
const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/** Verification is not urgent, and a link that dies overnight is a support ticket. */
const VERIFICATION_TOKEN_TTL_SECONDS = 60 * 60 * 24;

/** The shape `/sign-in/email` is called with, as far as this needs to care. */
function credentials(body: unknown): { readonly email: string } | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const { email } = body as { email?: unknown };
  return typeof email === 'string' ? { email } : null;
}

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

      /**
       * Spec §7.5's password reset.
       *
       * better-auth owns the security of this: the token is single-use (it is
       * consumed, not merely checked), it expires, and a request for an address
       * that has no account returns the same answer after the same work, so the
       * endpoint cannot be used to find out who is registered. All this function
       * does is render the message and hand it to a transport.
       */
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      sendResetPassword: async ({ user, url }, request) => {
        await sendEmail(
          passwordResetEmail({
            to: user.email,
            url,
            locale: localeForEmail(user, request),
            expiresInMinutes: RESET_TOKEN_TTL_SECONDS / 60,
          }),
        );
      },
    },

    /**
     * Spec §7.5: verification is a fast-follow, and play is never gated on it —
     * `requireEmailVerification` stays off (its default).
     *
     * That is not only a product choice. The guest → account claim rides on the
     * anonymous plugin's link hook, which only fires when a sign-up actually
     * issues a session; requiring verification with auto-sign-in off would stop
     * the hook and lose the guest's history. Anything that turns verification
     * into a gate has to re-test that path.
     */
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: VERIFICATION_TOKEN_TTL_SECONDS,
      sendVerificationEmail: async ({ user, url }, request) => {
        const locale = localeForEmail(user, request);

        // `sendEmail` reports failure rather than throwing: a verification mail
        // that cannot be sent must not fail a registration that has already
        // succeeded, and the person can ask for another.
        await sendEmail(
          verificationEmail({ to: user.email, url: landingFor(url, locale), locale }),
        );
      },
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

    /**
     * Agreed: one field accepting an email address or a display name.
     *
     * Done by rewriting the body before the endpoint runs, rather than in a route
     * of our own, so a username sign-in *is* an email sign-in: the same password
     * verification, the same rate limiting, the same guest claim, the same error.
     * Nothing downstream — including the browser — ever learns which of the two
     * was typed.
     */
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') {
          return;
        }

        const typed = credentials(ctx.body);
        if (typed === null) {
          // Malformed: leave it alone and let the endpoint reject it as it would
          // have anyway.
          return;
        }

        const email = await resolveSignInEmail(typed.email, (key) => nameRegistry.emailFor(key));

        return { context: { body: { ...ctx.body, email } } };
      }),
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
