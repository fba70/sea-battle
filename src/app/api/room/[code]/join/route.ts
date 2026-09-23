import { joinRoom } from '@/lib/game/lobby';
import { createLobbyStore } from '@/lib/game/lobby-store';
import { currentPlayer, unauthorized } from '@/lib/server-session';

/** Joins a private room by code (spec §7.4). The seat is assigned by the server. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const player = await currentPlayer();
  if (!player) {
    return unauthorized();
  }

  const { code } = await params;
  const result = await joinRoom(createLobbyStore(), player, code);

  if (!result.ok) {
    const status =
      result.reason === 'room_not_found' || result.reason === 'invalid_code' ? 404 : 409;
    return Response.json({ error: result.reason }, { status });
  }

  return Response.json(result.seating);
}
