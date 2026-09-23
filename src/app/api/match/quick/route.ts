import { quickMatch } from '@/lib/game/lobby';
import { createLobbyStore } from '@/lib/game/lobby-store';
import { currentPlayer, unauthorized } from '@/lib/server-session';

/**
 * Joins the quick-match queue, and pairs immediately if someone compatible is waiting
 * (spec §7.4).
 *
 * Polled by the waiting client: every call re-attempts the pairing, so two players who
 * both arrived to an empty queue are matched on the next poll. Guests queue in their
 * own unrated pool (spec §4, OQ-6) — which pool is decided from the session, not the
 * request.
 */
export async function POST(): Promise<Response> {
  const player = await currentPlayer();
  if (!player) {
    return unauthorized();
  }

  return Response.json(await quickMatch(createLobbyStore(), player));
}

/** Leaves the queue. */
export async function DELETE(): Promise<Response> {
  const player = await currentPlayer();
  if (!player) {
    return unauthorized();
  }

  await createLobbyStore().dequeue(player.id);
  return Response.json({ status: 'left' });
}
