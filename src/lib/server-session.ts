import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';

import { auth } from './auth';
import { db } from './db';
import { ratings } from './db/schema/game';
import type { LobbyPlayer } from './game/lobby';

/**
 * Resolves the caller from their better-auth session.
 *
 * This is the only place a request's identity comes from. No route reads a user id,
 * a seat or a game id out of a request body — spec §5.3: the client is untrusted.
 */
export async function currentPlayer(): Promise<LobbyPlayer | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user;
  if (!user) {
    return null;
  }

  const isAnonymous = user.isAnonymous === true;

  // Guests have no rating row by construction (Block 2), so they never get queried.
  let rating = 1500;
  if (!isAnonymous) {
    const rows = await db
      .select({ rating: ratings.rating })
      .from(ratings)
      .where(and(eq(ratings.userId, user.id), eq(ratings.mode, 'classic')))
      .limit(1);
    rating = rows[0]?.rating ?? 1500;
  }

  return { id: user.id, isAnonymous, rating };
}

export function unauthorized(): Response {
  return Response.json({ error: 'not_signed_in' }, { status: 401 });
}
