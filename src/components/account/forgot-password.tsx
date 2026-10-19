'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

/**
 * Asking for a password reset link (spec §7.5).
 *
 * The confirmation never says whether the address exists. better-auth already
 * answers identically either way, and does the same work so the timing matches —
 * this screen must not undo that by reacting differently to the two cases. So it
 * shows one message, always, including when the request itself fails.
 */
export function ForgotPassword({ onBack }: { readonly onBack: () => void }) {
  const t = useTranslations('account');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);

    try {
      await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}${window.location.pathname.replace(/\/account.*$/, '/account/reset')}`,
      });
    } catch {
      // Swallowed on purpose: a network failure must not become a signal about
      // whether that address is registered.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-sm leading-relaxed text-pretty">
          {t('forgotSent')}
        </p>
        <Button type="button" variant="outline" onClick={onBack}>
          {t('backToSignIn')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-email" className="text-sm font-medium">
          {t('email')}
        </label>
        <input
          id="reset-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
          className="rounded-md border border-border bg-background px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      </div>

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? t('working') : t('forgotSubmit')}
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="rounded-sm text-sm text-muted-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {t('backToSignIn')}
      </button>
    </form>
  );
}
