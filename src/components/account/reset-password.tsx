'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';
import { authClient } from '@/lib/auth-client';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-rules';

/**
 * Setting a new password from an emailed link (spec §7.5).
 *
 * The token arrives in the query string and is spent here: better-auth consumes
 * it rather than merely checking it, so the same link cannot be used twice. A
 * link that is expired, already used or absent all land in the same place — a
 * plain "ask for another" — because telling them apart would say something about
 * what the token was.
 */
export function ResetPassword() {
  const t = useTranslations('account');
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (token === null) {
      setFailed(true);
      return;
    }

    setBusy(true);
    setFailed(false);

    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setFailed(true);
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-sm leading-relaxed">
          {t('resetDone')}
        </p>
        <Button asChild size="lg">
          <Link href="/account">{t('signIn')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-password" className="text-sm font-medium">
          {t('password')}
        </label>
        <input
          id="new-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          aria-describedby="new-password-hint"
          className="rounded-md border border-border bg-background px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <p id="new-password-hint" className="text-xs text-muted-foreground">
          {t('passwordHint', { min: MIN_PASSWORD_LENGTH })}
        </p>
      </div>

      {failed || token === null ? (
        <p role="alert" className="text-sm text-destructive">
          {t('resetInvalid')}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? t('working') : t('resetSubmit')}
      </Button>

      <Link
        href="/account"
        className="rounded-sm text-center text-sm text-muted-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {t('backToSignIn')}
      </Link>
    </form>
  );
}
