import { completeLiveGame } from '@/lib/game/live-game';
import { createLiveGameStore } from '@/lib/game/live-game-store';
import { createRatingStore } from '@/lib/rating/rating-store';
import { processFinishedGame } from '@/lib/rating/process';
import { serverEnv } from '@/lib/env';
import { RESULT_SIGNATURE_HEADER, verifyResultReport } from '@/server/result-report';

/**
 * Where the realtime layer reports a finished match (spec §5.1).
 *
 * The Durable Object has no database credentials by design, so it signs the outcome
 * and this route does the writing. Authentication is the HMAC signature alone — there
 * is no session here, because the caller is our own game layer, not a browser.
 *
 * Idempotent end to end: completing the row is a compare-and-set on `status`, and the
 * Block 4 rating processor claims the game by writing its still-null deltas. A retried
 * report is therefore safe and expected.
 */
export async function POST(request: Request): Promise<Response> {
  // The raw body is what was signed; re-serialising an object could change key order.
  const body = await request.text();

  const verified = await verifyResultReport(
    body,
    request.headers.get(RESULT_SIGNATURE_HEADER),
    serverEnv.GAME_TICKET_SECRET,
  );

  if (!verified.ok) {
    // Deliberately terse, and the same shape for both causes.
    return Response.json({ error: verified.reason }, { status: 401 });
  }

  const outcome = await completeLiveGame(
    createLiveGameStore(),
    (gameId) => processFinishedGame(createRatingStore(), gameId),
    verified.report,
  );

  if (outcome.status === 'rejected') {
    return Response.json({ error: outcome.reason }, { status: 422 });
  }

  return Response.json({ status: outcome.status, rating: outcome.rating.status });
}
