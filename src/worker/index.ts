/// <reference types="@cloudflare/workers-types" />
/**
 * The realtime entry point (spec §5.1, OQ-2 decided: Cloudflare Durable Objects).
 *
 * This Worker is deliberately thin. It does no authentication, holds no state and knows
 * no rules: it maps a URL to the one Durable Object that owns that game and forwards
 * the upgrade. Ticket verification happens inside the Durable Object, so there is a
 * single place where a connection is authorised rather than a trusted-header hand-off.
 */
import { GameRoom } from './game-room';
import type { Env } from './env';

export { GameRoom };

/** `/game/:gameId/ws` */
const ROUTE = /^\/game\/([A-Za-z0-9_-]{1,128})\/ws$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = ROUTE.exec(url.pathname);

    if (!match) {
      return new Response('Not found', { status: 404 });
    }

    const gameId = match[1] as string;

    // One object per game id, so both players land on the same authoritative actor.
    const id = env.GAME_ROOM.idFromName(gameId);
    const stub = env.GAME_ROOM.get(id);

    // The game id travels as a parameter so the room can check it against the ticket.
    url.searchParams.set('gameId', gameId);
    return stub.fetch(new Request(url, request));
  },
} satisfies ExportedHandler<Env>;
