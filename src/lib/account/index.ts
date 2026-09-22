/**
 * Account identity: the guest → registered conversion from spec §7.5.
 *
 * `claim.ts` holds the policy (pure, transport- and database-free); `claim-store.ts`
 * is the Neon implementation it drives. Both are wired into better-auth's
 * `anonymous({ onLinkAccount })` in src/lib/auth.ts — there is no separate claim
 * endpoint, because the authenticated session is the only acceptable proof of which
 * guest is being converted.
 *
 * ## Deferred, deliberately
 *
 * Spec §7.5 tags email verification and password reset as **P1 priority**, not Phase 1
 * scope, and §7.14 wants transactional email in the recipient's locale. All three need
 * an email provider, which the spec never names and we have not chosen — so none of
 * them are built here, and no provider, sender domain, credential or production URL is
 * referenced anywhere in this directory.
 *
 * One consequence to know before that work starts: the claim rides on better-auth's
 * anonymous-plugin hook, which only fires when a sign-up actually issues a session
 * token. Turning on `requireEmailVerification` with auto-sign-in disabled would stop
 * the hook firing, and the guest would never be claimed. Whoever picks up the email
 * block has to re-test the claim against that configuration.
 */
export * from './claim';
export * from './claim-store';
