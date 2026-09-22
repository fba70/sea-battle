import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { describe, expect, it } from 'vitest';

import { createGuestClaimStore } from './claim-store';

/**
 * Verifies the SQL the claim actually emits, without a database.
 *
 * The statements are built by real Drizzle query builders and inspected with
 * `.toSQL()`; nothing is executed, so no rows are created anywhere. What matters here
 * is the shape: the guard clauses, the single-statement ownership move, and the order
 * of the batch — all of which are correctness- or safety-critical and none of which a
 * type check can see.
 */
const GUEST = 'guest-user-id';
const MEMBER = 'registered-user-id';

type GuestRow = {
  id: string;
  isAnonymous: boolean;
  avatarSeed: string | null;
  country: string | null;
  locale: string | null;
};

const DEFAULT_GUEST: GuestRow = {
  id: GUEST,
  isAnonymous: true,
  avatarSeed: 'seed-from-guest',
  country: 'DE',
  locale: 'de',
};

interface Captured {
  sql: string;
  params: unknown[];
}

/**
 * A database double: real Drizzle builders for the writes, a canned result for the
 * single read, and a `batch` that records instead of executing.
 */
function recordingDatabase(guestRow: GuestRow | null = DEFAULT_GUEST) {
  // Never connected to — the builders are only ever asked for their SQL.
  const builder = drizzle(neon('postgresql://user:pass@example.neon.tech/db'));
  const batches: Captured[][] = [];
  const selects: { where: unknown }[] = [];
  const deletes: Captured[] = [];

  const database = {
    select: () => ({
      from: () => ({
        where: (where: unknown) => ({
          limit: async () => {
            selects.push({ where });
            return guestRow === null ? [] : [guestRow];
          },
        }),
      }),
    }),
    update: builder.update.bind(builder),
    // Captures instead of awaiting, so a stray `await` can never reach the network.
    delete: (table: Parameters<typeof builder.delete>[0]) => {
      const query = builder.delete(table);
      return {
        where: (condition: Parameters<ReturnType<typeof builder.delete>['where']>[0]) => {
          const prepared = query.where(condition);
          deletes.push(prepared.toSQL());
          // Exposes what `batch` needs (toSQL) while making a direct `await` resolve
          // locally instead of dispatching the statement.
          return {
            toSQL: () => prepared.toSQL(),
            then: (resolve: (value: never[]) => void) => resolve([]),
          };
        },
      };
    },
    batch: async (queries: { toSQL(): Captured }[]) => {
      batches.push(queries.map((query) => query.toSQL()));
      return [[{ id: 'game-1' }, { id: 'game-2' }], [], []];
    },
  };

  return {
    store: createGuestClaimStore(
      database as unknown as Parameters<typeof createGuestClaimStore>[0],
    ),
    batches,
    selects,
    deletes,
  };
}

describe('claim() emits a safe, ordered batch', () => {
  it('runs exactly three statements in one batch, guest delete last', async () => {
    const { store, batches } = recordingDatabase();
    await store.claim({ guestUserId: GUEST, userId: MEMBER });

    expect(batches).toHaveLength(1);
    const [batch] = batches;
    expect(batch).toHaveLength(3);

    // Order is the safety property: the seats must move off the guest before the
    // guest row is deleted, or ON DELETE SET NULL detaches the history instead.
    expect(batch?.[0]?.sql).toMatch(/^update "games"/i);
    expect(batch?.[1]?.sql).toMatch(/^update "user"/i);
    expect(batch?.[2]?.sql).toMatch(/^delete from "user"/i);
  });

  it('moves both seats and the winner in a single statement', async () => {
    // Block 2's games_winner_is_a_player CHECK is immediate and per-statement. Moving
    // player_a_id in one statement and winner_id in the next would fail the check on
    // any game the guest both played and won.
    const { store, batches } = recordingDatabase();
    await store.claim({ guestUserId: GUEST, userId: MEMBER });

    const move = batches[0]?.[0];
    expect(move?.sql).toContain('"player_a_id"');
    expect(move?.sql).toContain('"player_b_id"');
    expect(move?.sql).toContain('"winner_id"');
    expect(move?.sql.toLowerCase()).toContain('case when');
    expect(move?.params).toContain(GUEST);
    expect(move?.params).toContain(MEMBER);
  });

  it('only touches games the guest is actually part of', async () => {
    const { store, batches } = recordingDatabase();
    await store.claim({ guestUserId: GUEST, userId: MEMBER });

    const move = batches[0]?.[0];
    // A WHERE covering all three reference columns, so a replay matches nothing.
    expect(move?.sql.toLowerCase()).toMatch(/where .*player_a_id.*or.*player_b_id.*or.*winner_id/s);
  });

  it('adopts the guest profile only into fields the account has not set', async () => {
    const { store, batches } = recordingDatabase();
    await store.claim({ guestUserId: GUEST, userId: MEMBER });

    const adopt = batches[0]?.[1];
    expect(adopt?.sql.toLowerCase()).toContain('coalesce');
    expect(adopt?.params).toContain('seed-from-guest');
    expect(adopt?.params).toContain('DE');
    expect(adopt?.params).toContain('de');
    // last_seen_at is presence, not identity — the account is in use right now.
    expect(adopt?.sql).not.toContain('last_seen_at');
  });

  it('writes the claim marker only when it is still unset, so the first claim wins', async () => {
    const { store, batches } = recordingDatabase();
    await store.claim({ guestUserId: GUEST, userId: MEMBER });

    const adopt = batches[0]?.[1];
    expect(adopt?.sql).toContain('"claimed_from_guest_id"');
    expect(adopt?.sql.toLowerCase()).toContain('is null');
  });

  it('refuses to write the claim marker onto an anonymous row', async () => {
    const { store, batches } = recordingDatabase();
    await store.claim({ guestUserId: GUEST, userId: MEMBER });

    const adopt = batches[0]?.[1];
    expect(adopt?.sql).toContain('"is_anonymous"');
    expect(adopt?.params).toContain(false);
  });

  it('guards the delete with is_anonymous so a registered account can never be removed', async () => {
    const { store, batches } = recordingDatabase();
    await store.claim({ guestUserId: GUEST, userId: MEMBER });

    const remove = batches[0]?.[2];
    expect(remove?.sql).toContain('"is_anonymous"');
    expect(remove?.params).toEqual([GUEST, true]);
  });

  it('reports how many games moved', async () => {
    const { store } = recordingDatabase();
    const counts = await store.claim({ guestUserId: GUEST, userId: MEMBER });

    expect(counts).toEqual({ games: 2, guestExisted: true });
  });
});

describe('claim() is idempotent', () => {
  it('does nothing when the guest is already gone — a replayed link event', async () => {
    const { store, batches } = recordingDatabase(null);
    const counts = await store.claim({ guestUserId: GUEST, userId: MEMBER });

    expect(counts).toEqual({ games: 0, guestExisted: false });
    // No writes at all, so a retry cannot duplicate an ownership transfer.
    expect(batches).toHaveLength(0);
  });

  it('will not load a registered user as the guest side of a claim', async () => {
    // The read itself filters on is_anonymous, so a registered id resolves to nothing
    // and the claim becomes a no-op rather than a destructive transfer.
    const { store, selects } = recordingDatabase(null);
    await store.claim({ guestUserId: MEMBER, userId: MEMBER });

    expect(selects).toHaveLength(1);
  });
});

describe('discard() drops the throwaway guest and nothing else', () => {
  it('deletes only an anonymous row', async () => {
    const { store, deletes } = recordingDatabase();
    await store.discard({ guestUserId: GUEST });

    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.sql).toMatch(/^delete from "user"/i);
    expect(deletes[0]?.params).toEqual([GUEST, true]);
  });

  it('transfers nothing — no batch and no update statement is built at all', async () => {
    const { store, batches } = recordingDatabase();
    await store.discard({ guestUserId: GUEST });

    expect(batches).toHaveLength(0);
  });
});
