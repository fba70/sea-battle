'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import {
  checkDisplayName,
  suggestDisplayName,
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
} from '@/lib/account/display-name';
import { authClient } from '@/lib/auth-client';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-rules';
import { resetGuestSession } from '@/lib/guest-session';

/**
 * Sign in, or create an account (spec §7.5).
 *
 * One panel with two modes rather than two pages: the two forms differ by a single
 * field, and somebody who came to sign in and discovers they have no account should
 * not have to go looking for the other page.
 *
 * Registering while playing as a guest keeps that guest's history — better-auth's
 * anonymous plugin links the two and the server moves the data across. Nothing here
 * has to ask for it, and nothing here could be trusted to.
 */
type Mode = 'signIn' | 'signUp';

/** Maps a better-auth failure onto something a person can act on. */
function problemKey(code: string | undefined, message: string | undefined): string {
  if (code === 'DISPLAY_NAME_TAKEN') {
    return 'name.taken';
  }
  if (code === 'INVALID_DISPLAY_NAME') {
    return `name.${message ?? 'invalid_characters'}`;
  }
  if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
    return 'emailTaken';
  }
  if (code === 'INVALID_EMAIL_OR_PASSWORD' || code === 'INVALID_EMAIL') {
    return 'badCredentials';
  }
  if (code === 'PASSWORD_TOO_SHORT') {
    return 'passwordTooShort';
  }
  return 'unknown';
}

export function AuthPanel() {
  const t = useTranslations('account');
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameProblem = useMemo(() => {
    if (mode !== 'signUp' || name === '') {
      return null;
    }
    const checked = checkDisplayName(name);
    return checked.ok ? null : checked.problem;
  }, [mode, name]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result =
        mode === 'signUp'
          ? await authClient.signUp.email({ email, password, name: name.trim() })
          : await authClient.signIn.email({ email, password });

      if (result.error) {
        setError(problemKey(result.error.code, result.error.message));
        return;
      }

      // The guest identity this browser was holding is gone — claimed on sign-up,
      // discarded on sign-in. Either way the memoised copy must not be reused.
      resetGuestSession();
      router.push('/play');
      router.refresh();
    } catch {
      setError('unknown');
    } finally {
      setBusy(false);
    }
  }

  const signUp = mode === 'signUp';

  return (
    <section className="w-full rounded-xl border border-border bg-card px-6 py-8 sm:px-8">
      <div
        role="tablist"
        aria-label={t('title')}
        className="mb-6 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1"
      >
        {(['signIn', 'signUp'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
              // Offered when the field first appears, not at mount: a suggestion
              // generated during render would differ between the server's HTML and
              // the client's, and the page is statically rendered.
              if (value === 'signUp') {
                setName((current) => (current === '' ? suggestDisplayName() : current));
              }
            }}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              mode === value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(value === 'signIn' ? 'signIn' : 'createAccount')}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        {signUp ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="display-name" className="text-sm font-medium">
              {t('displayName')}
            </label>
            <input
              id="display-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              minLength={DISPLAY_NAME_MIN_LENGTH}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              autoComplete="username"
              aria-describedby="display-name-hint"
              aria-invalid={nameProblem !== null}
              className="rounded-md border border-border bg-background px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            <p id="display-name-hint" className="text-xs text-muted-foreground">
              {nameProblem === null
                ? t('displayNameHint', {
                    min: DISPLAY_NAME_MIN_LENGTH,
                    max: DISPLAY_NAME_MAX_LENGTH,
                  })
                : t(`errors.name.${nameProblem}`)}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            {t('email')}
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            className="rounded-md border border-border bg-background px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            {t('password')}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete={signUp ? 'new-password' : 'current-password'}
            aria-describedby={signUp ? 'password-hint' : undefined}
            className="rounded-md border border-border bg-background px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          {signUp ? (
            <p id="password-hint" className="text-xs text-muted-foreground">
              {t('passwordHint', { min: MIN_PASSWORD_LENGTH })}
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${error}`)}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={busy || nameProblem !== null}>
          {busy ? t('working') : t(signUp ? 'createAccount' : 'signIn')}
        </Button>
      </form>

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        {signUp ? t('signUpNote') : t('signInNote')}
      </p>
    </section>
  );
}
