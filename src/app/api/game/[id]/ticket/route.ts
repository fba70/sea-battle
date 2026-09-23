import { createLobbyStore } from '@/lib/game/lobby-store';
import { serverEnv } from '@/lib/env';
import { currentPlayer, unauthorized } from '@/lib/server-session';
import { mintGameTicket } from '@/server/ticket';

/**
 * Mints a short-lived connection ticket for the realtime layer (spec §5.2).
 *
 * The seat comes from the stored game, never from the request, and a ticket is only
 * issued to someone the game actually seats. That is what stops a client choosing its
 * own seat or connecting to a game it is not in — the Durable Object trusts the
 * signature, so this check is where the authorisation really happens.
 *
 * Tickets are deliberately short-lived, so the client asks for one when it is about to
 * connect and again when it reconnects.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const player = await currentPlayer();
  if (!player) {
    return unauthorized();
  }

  const { id } = await params;
  const seating = await createLobbyStore().findSeat({ gameId: id, playerId: player.id });
  if (!seating) {
    // Same answer whether the game does not exist or the caller is not in it.
    return Response.json({ error: 'not_a_participant' }, { status: 403 });
  }

  const ticket = await mintGameTicket(
    { gameId: seating.gameId, playerId: player.id, seat: seating.seat },
    serverEnv.GAME_TICKET_SECRET,
  );

  return Response.json({ ticket, seat: seating.seat, gameId: seating.gameId });
}
