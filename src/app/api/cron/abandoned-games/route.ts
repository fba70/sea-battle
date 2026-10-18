import { sweepAbandonedGames, ABANDONED_GAME_AFTER_MS } from '@/lib/game/lobby';
import { createLobbyStore } from '@/lib/game/lobby-store';
import { serverEnv } from '@/lib/env';

/**
 * Closes games that were left open and will never finish (spec §4).
 *
 * This is the *only* thing that performs that sweep. It used to run whenever someone
 * created a room, which meant ordinary play — and any test that opens a room — would
 * silently rewrite unrelated rows. Housekeeping that changes data nobody asked about
 * belongs on a schedule of its own, where it is visible and predictable.
 *
 * Authorisation is a bearer secret, and the route **fails closed**: with no
 * `CRON_SECRET` configured there is no scheduled job, and an unauthenticated
 * endpoint that rewrites rows would be worse than no endpoint at all. That also
 * means nothing can trigger it on a developer machine by accident.
 *
 * Vercel's scheduler sends `Authorization: Bearer <CRON_SECRET>` on a GET, which is
 * why this is a GET; `vercel.json` holds the schedule.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = serverEnv.CRON_SECRET;

  if (secret === undefined) {
    return Response.json({ error: 'not_configured' }, { status: 503 });
  }

  // Constant-time-ish is not the concern here: the secret is long, the endpoint is
  // not enumerable from the client, and a timing oracle on a maintenance route buys
  // an attacker nothing an authorised run would not already do.
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const closed = await sweepAbandonedGames(createLobbyStore());

  return Response.json({
    status: 'swept',
    closed,
    olderThanMs: ABANDONED_GAME_AFTER_MS,
  });
}
