import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema/auth';
import { hasLocale } from 'next-intl';
import { headers } from 'next/headers';
import { routing } from '@/i18n/routing';

/**
 * The signed-in player's language (spec §7.14).
 *
 * §7.14's detection order puts `users.locale` ahead of the cookie, so that a
 * choice made on one device is honoured on the next. Reading it in middleware
 * would mean a database query on every request, so instead this is read once after
 * signing in and applied to the cookie — which every later request already uses.
 *
 * Written for guests too. The column is on every user, and spec §7.5's account
 * claim copies it across, which is how "guest choice carries over on account
 * claim" actually happens.
 */

async function currentUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user?.id ?? null;
}

export async function GET(): Promise<Response> {
  const userId = await currentUserId();
  if (userId === null) {
    return Response.json({ error: 'not_signed_in' }, { status: 401 });
  }

  const rows = await db
    .select({ locale: user.locale })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return Response.json(
    { locale: rows[0]?.locale ?? null },
    { headers: { 'cache-control': 'private, no-store' } },
  );
}

export async function PUT(request: Request): Promise<Response> {
  const userId = await currentUserId();
  if (userId === null) {
    return Response.json({ error: 'not_signed_in' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'malformed' }, { status: 400 });
  }

  const requested = (payload as { locale?: unknown } | null)?.locale;

  // Only one of the five the app actually ships; the column has a CHECK saying the
  // same thing, and this gives a clean refusal instead of a constraint violation.
  if (typeof requested !== 'string' || !hasLocale(routing.locales, requested)) {
    return Response.json({ error: 'unsupported_locale' }, { status: 422 });
  }

  await db.update(user).set({ locale: requested }).where(eq(user.id, userId));

  return Response.json({ locale: requested });
}
