import { and, eq, sql } from 'drizzle-orm';

import { db as defaultDb } from '../db';
import { user } from '../db/schema/auth';

/**
 * Who already holds a display name, and what address signs in as it (spec §7.5).
 *
 * `isTaken` is only a *friendly* answer: the authority is the partial unique index
 * on `lower(name)`, because two people can register the same name between this
 * check and the insert. It exists so the common case gets "that name is taken"
 * instead of a constraint violation.
 */
export interface DisplayNameRegistry {
  /** `key` is already lower-cased by `displayNameKey`. */
  isTaken(key: string): Promise<boolean>;
  /**
   * The email behind a display name, for signing in with a username.
   *
   * Never reaches the browser: the caller hands it straight to better-auth's
   * email sign-in. Exposing it would turn the sign-in form into a way to read
   * any player's address off their public leaderboard name.
   */
  emailFor(key: string): Promise<string | null>;
}

type Database = typeof defaultDb;

/** Matches the index exactly: lower(name), registered accounts only. */
function sameName(key: string) {
  // Guests are all called "Anonymous" and hold no place in the namespace, so they
  // are neither "taken" nor signed in to.
  return and(sql`lower(${user.name}) = ${key}`, eq(user.isAnonymous, false));
}

export function createDisplayNameRegistry(database: Database = defaultDb): DisplayNameRegistry {
  return {
    async isTaken(key: string): Promise<boolean> {
      const rows = await database.select({ id: user.id }).from(user).where(sameName(key)).limit(1);

      return rows.length > 0;
    },

    async emailFor(key: string): Promise<string | null> {
      const rows = await database
        .select({ email: user.email })
        .from(user)
        .where(sameName(key))
        .limit(1);

      return rows[0]?.email ?? null;
    },
  };
}
