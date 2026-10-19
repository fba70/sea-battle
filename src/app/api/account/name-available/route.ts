import { checkDisplayName, displayNameKey } from '@/lib/account/display-name';
import { createDisplayNameRegistry } from '@/lib/account/name-registry';

/**
 * Whether a display name can be registered (spec §7.5).
 *
 * Advisory only. Sign-up re-checks the same rules server-side and a unique index
 * arbitrates the race, so a "yes" here is a courtesy to the form, never a promise —
 * and a "no" is always honoured.
 *
 * Takes a name and returns a verdict: it reveals whether a name exists, which is
 * already visible on the leaderboard, and nothing else about the account.
 */
export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('name') ?? '';

  // Bounded before any work: an unbounded string has no business reaching a query.
  if (raw.length > 100) {
    return Response.json({ available: false, problem: 'too_long' });
  }

  const checked = checkDisplayName(raw);
  if (!checked.ok) {
    return Response.json({ available: false, problem: checked.problem });
  }

  const taken = await createDisplayNameRegistry().isTaken(displayNameKey(checked.name));

  return Response.json(taken ? { available: false, problem: 'taken' } : { available: true }, {
    headers: { 'cache-control': 'no-store' },
  });
}
