import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

/**
 * better-auth core tables, plus the single column the anonymous plugin needs.
 *
 * These four tables are required for better-auth to initialise at all. The Phase 1
 * game and rating tables live in ./game.ts; the Phase 2+ tables spec §6 sketches
 * (badges, streaks, tournaments, cosmetics, purchases) are deliberately absent.
 */
export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified')
      .$defaultFn(() => false)
      .notNull(),
    image: text('image'),
    /**
     * Spec §7.5 / §6 `users.role`: distinguishes a guest from a registered user.
     * Written by the better-auth anonymous plugin; the guest -> account claim in
     * Phase 1 flips it to false rather than creating a second identity.
     */
    // A SQL-level default keeps this migration safe to apply to a table that
    // already holds rows.
    isAnonymous: boolean('is_anonymous').default(false).notNull(),
    createdAt: timestamp('created_at')
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp('updated_at')
      .$defaultFn(() => new Date())
      .notNull(),

    // ---- Phase 1 profile fields (spec §6 `users`) -------------------------
    // All nullable and unwritten so far: the flows that populate them (account
    // claim, profile, localized email) are later blocks. better-auth's own `name`
    // serves as §6's `display_name`, so no second name column is added.

    /** Spec §7.5: deterministic generated avatar. */
    avatarSeed: text('avatar_seed'),
    /** Spec §7.7: optional flag beside a leaderboard entry. */
    country: text('country'),
    /** Spec §7.14: the locale to address this user in, e.g. transactional email. */
    locale: text('locale'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /**
     * Spec §6: the guest row this account was claimed from. Deliberately not a
     * foreign key — the guest row is deleted as part of the claim, so the id is
     * kept as a historical record rather than a live reference.
     */
    claimedFromGuestId: text('claimed_from_guest_id'),
  },
  (table) => [
    /**
     * `id` is already unique as the primary key. This pair exists purely to give
     * `ratings` a composite foreign-key target, which is how "a guest can never hold
     * a rating" is enforced in the database rather than in application code.
     */
    unique('user_id_is_anonymous_key').on(table.id, table.isAnonymous),
    check('user_locale_valid', sql`"locale" is null or "locale" in ('en', 'de', 'es', 'it', 'fr')`),
  ],
);

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').$defaultFn(() => new Date()),
});
