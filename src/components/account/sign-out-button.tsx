'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { resetGuestSession } from '@/lib/guest-session';

/**
 * Signing out (spec §7.5).
 *
 * One implementation, shared by the header and a player's own profile, so there
 * is a single place that knows what signing out has to do besides dropping the
 * cookie — namely forget the memoised guest identity, or the next page view
 * would hand out the signed-in one again.
 *
 * Styling is the caller's: the header wants a plain word next to a name, the
 * profile wants a button beside another button.
 */
export function SignOutButton({ className }: { readonly className?: string }) {
  const t = useTranslations('account');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);
    try {
      await authClient.signOut();
      resetGuestSession();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={() => void signOut()} disabled={busy} className={className}>
      {t('signOut')}
    </button>
  );
}
