'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { LiveMatchScreen } from './live-match-screen';

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
    <main className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      {state.phase === 'error' ? (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {t(`errors.${state.reason}` as 'errors.unknown')}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm">
            {t('codeLabel')}{' '}
            <span className="font-mono text-lg font-semibold tracking-widest">{code}</span>
          </p>
          <p className="text-muted-foreground mt-4 text-sm">{t('share')}</p>
          <div className="mt-2 flex gap-2">
            <input
              readOnly
              value={shareUrl}
              aria-label={t('share')}
              className="border-border w-full rounded-md border px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(shareUrl).then(() => setCopied(true));
              }}
              className="border-border shrink-0 rounded-md border px-3 py-2 text-sm"
            >
              {copied ? t('copied') : t('copy')}
            </button>
          </div>
          <p className="text-muted-foreground mt-6 text-sm" role="status" aria-live="polite">
            {t('waiting')}
          </p>
        </>
      )}
    </main>
  );
}
