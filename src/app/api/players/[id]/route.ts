import { createLeaderboardStore } from '@/lib/leaderboard/leaderboard-store';
import { publicStanding } from '@/lib/leaderboard/serialize';
import { currentPlayer } from '@/lib/server-session';

const HISTORY_LIMIT = 20;

/**
 * One player's public profile, and their match history when they are the caller.
 *
 * Spec §7.7 publishes name, rating and record, so those are public. Spec §2 keeps
 * game history private to the player in v1, so `history` is only read when the
 * caller owns the profile — not filtered afterwards, not loaded at all.
 *
 * Nothing in either projection touches stored board state.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const store = createLeaderboardStore();
  const standing = await store.standing({ userId: id, mode: 'classic', now: new Date() });

  if (!standing) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const viewer = await currentPlayer();
  const isOwner = viewer?.id === id;

  return Response.json(
    {
      player: publicStanding(standing, { includeActivity: isOwner }),
      history: isOwner ? await store.history({ userId: id, limit: HISTORY_LIMIT }) : null,
    },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}
