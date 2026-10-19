import { and, eq, sql } from 'drizzle-orm';

import { db as defaultDb } from '../db';
import { user } from '../db/schema/auth';

/**
 * Who already holds a display name (spec §7.5).
 *
 * Only a *friendly* answer: the authority is the partial unique index on
 * `lower(name)`, because two people can register the same name between this check
 * and the insert. This exists so the common case gets "that name is taken" instead
 * of a constraint violation.
 */
export interface DisplayNameRegistry {
  /** `key` is already lower-cased by `displayNameKey`. */
  isTaken(key: string): Promise<boolean>;
}

type Database = typeof defaultDb;

export function createDisplayNameRegistry(database: Database = defaultDb): DisplayNameRegistry {
  return {
    async isTaken(key: string): Promise<boolean> {
      // Matches the index exactly: lower(name), registered accounts only. Guests are
      // all called "Anonymous" and are not part of the namespace.
      const rows = await database
        .select({ id: user.id })
        .from(user)
        .where(and(sql`lower(${user.name}) = ${key}`, eq(user.isAnonymous, false)))
        .limit(1);

      return rows.length > 0;
    },
  };
}
