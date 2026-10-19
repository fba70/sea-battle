'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { authClient, useSession } from '@/lib/auth-client';
import { resetGuestSession } from '@/lib/guest-session';

/**
 * Who you are, in the site header (spec §7.5).
 *
 * A client component on purpose: every content page is statically rendered, and
 * reading the session on the server would make all of them dynamic for the sake of
 * one word in the corner. The cost is that the control resolves after hydration,
 * so it reserves its space and shows nothing rather than flickering "Sign in" at
 * someone who is already signed in.
 *
 * A guest is treated as signed out here. They have a session, but not an identity
 * worth showing — and what they need offered is an account.
 */
export function SessionControl() {
  const t = useTranslations('account');
  const router = useRouter();
  const { data, isPending } = useSession();
  const [busy, setBusy] = useState(false);

  const user = data?.user;
  const signedIn = user !== undefined && user.isAnonymous !== true;

  async function signOut(): Promise<void> {
    setBusy(true);
    try {
      await authClient.signOut();
      // The next page view mints a fresh guest; without this the memoised identity
      // from the signed-in session would be handed out again.
      resetGuestSession();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (isPending) {
    // Holds the row height steady while the session resolves.
    return <span className="inline-block h-5 w-16" aria-hidden />;
  }

  if (!signedIn) {
    return (
      <Link
        href="/account"
        className="rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {t('signIn')}
      </Link>
    );
  }

  return (
    <span className="flex items-center gap-2 text-sm">
      <Link
        href={`/players/${user.id}`}
        className="max-w-[10rem] truncate rounded-sm font-medium transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {user.name}
      </Link>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy}
        className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
      >
        {t('signOut')}
      </button>
    </span>
  );
}
