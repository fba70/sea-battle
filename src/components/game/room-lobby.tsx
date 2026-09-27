'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { HeroGrid } from '@/components/hero-grid';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { ensureGuestSession } from '@/lib/guest-session';

/**
 * Create a private room, or join one by code (spec §7.4).
 *
 * One card with two clearly separated jobs — start a room, or join one someone sent
 * you — in the same card/token language as the waiting screens, so the entry point
 * does not look like a different product from what follows it.
 */
export function RoomLobby() {
  const t = useTranslations('multiplayer.room');
  const router = useRouter();
  const [busy, setBusy] = useState<'create' | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create(): Promise<void> {
    setBusy('create');
    setError(null);
    try {
      // GuestSessionProvider blocks nothing, so on a fresh browser this request can
      // beat the anonymous sign-in and come back 401 — which reads as "your session
      // expired". `ensureGuestSession` reuses an existing session, so this is cheap.
      await ensureGuestSession();

      const response = await fetch('/api/room', { method: 'POST' });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? 'unknown');
        return;
      }
      const room = (await response.json()) as { code: string };
      router.push(`/play/room/${room.code}`);
    } catch {
      setError('unknown');
    } finally {
      setBusy(null);
    }
  }

  function join(event: FormEvent): void {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length === 0) {
      return;
    }
    // The room page performs the join, so a shared link and a typed code follow
    // exactly the same path.
    router.push(`/play/room/${trimmed.toUpperCase()}`);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-6">
      <section className="relative mx-auto w-full max-w-md overflow-hidden rounded-xl border border-border bg-card px-6 py-10 sm:py-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 overflow-hidden">
          <HeroGrid className="absolute -top-24 left-1/2 h-[20rem] w-[20rem] -translate-x-1/2 opacity-30" />
        </div>

        <div className="relative flex flex-col gap-6 sm:gap-5">
          <header className="flex flex-col gap-1.5 text-center">
            <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{t('lead')}</p>
          </header>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              size="lg"
              onClick={() => void create()}
              disabled={busy !== null}
              className="w-full"
            >
              {busy === 'create' ? t('creating') : t('create')}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t('createHint')}</p>
          </div>

          {/* Two jobs on one card, so the split needs to be visible. */}
          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase">
              {t('or')}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={join} className="flex flex-col gap-2">
            <label htmlFor="room-code" className="text-sm font-medium">
              {t('joinTitle')}
            </label>
            <div className="flex gap-2">
              <input
                id="room-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder={t('codePlaceholder')}
                aria-label={t('codeInput')}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                maxLength={12}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono tracking-[0.2em] uppercase placeholder:tracking-normal placeholder:normal-case focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              />
              <Button type="submit" variant="outline" className="shrink-0">
                {t('join')}
              </Button>
            </div>
          </form>

          {error ? (
            <p role="alert" className="text-center text-sm text-destructive">
              {t(`errors.${error}` as 'errors.unknown')}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
