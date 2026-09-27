'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { ensureGuestSession } from '@/lib/guest-session';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { LiveMatchScreen } from './live-match-screen';
import { WaitingPanel } from './waiting-panel';

type JoinState =
  | { phase: 'joining' }
  | { phase: 'waiting'; gameId: string }
  | { phase: 'ready'; gameId: string }
  | { phase: 'error'; reason: string };

/**
 * Joins a room by code, then hands over to the live match (spec §7.4).
 *
 * The seat and the game id come back from the server; nothing here proposes either.
 */
export function RoomMatch({ code, wsUrl }: { readonly code: string; readonly wsUrl: string }) {
  const t = useTranslations('multiplayer.room');
  const [state, setState] = useState<JoinState>({ phase: 'joining' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function attempt(): Promise<void> {
      try {
        // GuestSessionProvider deliberately blocks nothing, so on a fresh browser
        // this request can otherwise beat the anonymous sign-in and come back 401 —
        // which the UI then reports as "your session expired". `ensureGuestSession`
        // reuses an existing session, so awaiting it here is idempotent.
        await ensureGuestSession();

        const response = await fetch(`/api/room/${encodeURIComponent(code)}/join`, {
          method: 'POST',
        });
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setState({
            phase: 'error',
            reason: ((await response.json()) as { error?: string }).error ?? 'unknown',
          });
          return;
        }

        const seating = (await response.json()) as { gameId: string; ready: boolean };
        if (seating.ready) {
          setState({ phase: 'ready', gameId: seating.gameId });
          return;
        }

        // Host waiting for the second player: re-ask until the seat is filled.
        setState({ phase: 'waiting', gameId: seating.gameId });
        timer = setTimeout(() => void attempt(), 2000);
      } catch {
        if (!cancelled) {
          setState({ phase: 'error', reason: 'unknown' });
        }
      }
    }

    void attempt();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [code]);

  if (state.phase === 'ready') {
    return <LiveMatchScreen gameId={state.gameId} wsUrl={wsUrl} roomCode={code} />;
  }

  const shareUrl = typeof window === 'undefined' ? '' : window.location.href;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-6">
      {state.phase === 'error' ? (
        <WaitingPanel
          tone="problem"
          title={t('title')}
          description={t(`errors.${state.reason}` as 'errors.unknown')}
          actions={
            <Button asChild variant="outline" className="flex-1">
              <Link href="/play">{t('backToMenu')}</Link>
            </Button>
          }
        />
      ) : (
        <WaitingPanel
          title={t('waitingTitle')}
          description={t('shareHint')}
          status={t('waiting')}
          actions={
            <Button asChild variant="outline" className="flex-1">
              <Link href="/play">{t('backToMenu')}</Link>
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {t('codeLabel')}{' '}
              <span className="font-mono text-xl font-semibold tracking-[0.3em] text-foreground">
                {code}
              </span>
            </p>

            <div className="flex gap-2">
              <input
                readOnly
                value={shareUrl}
                aria-label={t('share')}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground"
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  void navigator.clipboard?.writeText(shareUrl).then(() => setCopied(true));
                }}
              >
                {copied ? t('copied') : t('copy')}
              </Button>
            </div>
          </div>
        </WaitingPanel>
      )}
    </main>
  );
}
