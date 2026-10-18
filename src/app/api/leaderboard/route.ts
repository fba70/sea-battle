import {
  LEADERBOARD_FRESHNESS_SECONDS,
  LEADERBOARD_TOP_N,
  loadBoard,
} from '@/lib/leaderboard/cached';
import { createLeaderboardStore } from '@/lib/leaderboard/leaderboard-store';
import { publicStanding } from '@/lib/leaderboard/serialize';
import { currentPlayer } from '@/lib/server-session';

/**
 * The ranked board, plus the caller's own position when they have one (spec §7.7).
 *
 * The board half is shared and served from the cached read; `you` is per-session,
 * which is why the response is marked private — a shared cache must never hand one
 * player's standing to another.
 *
 * Guests are never looked up: they cannot hold a rating row at all (Block 2).
 */
export async function GET(request: Request): Promise<Response> {
  const requested = Number(new URL(request.url).searchParams.get('limit'));
  const limit =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, LEADERBOARD_TOP_N)
      : LEADERBOARD_TOP_N;

  const board = await loadBoard('classic', limit);
  const player = await currentPlayer();

  const standing =
    player && !player.isAnonymous
      ? await createLeaderboardStore().standing({
          userId: player.id,
          mode: 'classic',
          now: new Date(),
        })
      : null;

  return Response.json(
    {
      mode: 'classic',
      freshnessSeconds: LEADERBOARD_FRESHNESS_SECONDS,
      rankedCount: board.rankedCount,
      entries: board.entries,
      you: standing ? publicStanding(standing, { includeActivity: true }) : null,
    },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}
