'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { LiveMatchScreen } from './live-match-screen';

type QueueState =
  | { phase: 'idle' }
  | { phase: 'searching'; pool: 'rated' | 'unrated' | null }
  | { phase: 'matched'; gameId: string };

const POLL_MS = 2000;

/**
 * Quick match (spec §7.4).
 *
 * Polls the queue endpoint: each call re-attempts the pairing server-side, so two
 * players who both arrived to an empty queue are matched on the next poll. Which pool
 * a player lands in is the server's decision, from their session.
 */
export function QuickMatch({ wsUrl }: { readonly wsUrl: string }) {
  const t = useTranslations('multiplayer.quick');
  const [state, setState] = useState<QueueState>({ phase: 'idle' });
  const searching = useRef(false);

  const poll = useCallback(async (): Promise<void> => {
    const response = await fetch('/api/match/quick', { method: 'POST' });
    if (!response.ok || !searching.current) {
      return;
    }

    const result = (await response.json()) as
      | { status: 'queued'; pool: 'rated' | 'unrated' }
      | { status: 'matched'; seating: { gameId: string } };

    if (result.status === 'matched') {
      searching.current = false;
      setState({ phase: 'matched', gameId: result.seating.gameId });
      return;
    }
    setState({ phase: 'searching', pool: result.pool });
  }, []);

  useEffect(() => {
    if (state.phase !== 'searching') {
      return;
    }
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [state.phase, poll]);

  // Leaving the page should not leave a ghost in the queue.
  useEffect(() => {
    return () => {
      if (searching.current) {
        void fetch('/api/match/quick', { method: 'DELETE', keepalive: true });
      }
    };
  }, []);

  if (state.phase === 'matched') {
    return <LiveMatchScreen gameId={state.gameId} wsUrl={wsUrl} />;
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      {state.phase === 'idle' ? (
        <button
          type="button"
          onClick={() => {
            searching.current = true;
            setState({ phase: 'searching', pool: null });
            void poll();
          }}
          className="bg-primary text-primary-foreground mt-6 w-full rounded-md px-4 py-2.5 font-medium"
        >
          {t('start')}
        </button>
      ) : (
        <>
          <p className="mt-6 text-sm" role="status" aria-live="polite">
            {t('searching')}
          </p>
          {state.pool ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {state.pool === 'rated' ? t('poolRated') : t('poolUnrated')}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              searching.current = false;
              void fetch('/api/match/quick', { method: 'DELETE' });
              setState({ phase: 'idle' });
            }}
            className="border-border mt-6 rounded-md border px-4 py-2 text-sm"
          >
            {t('cancel')}
          </button>
        </>
      )}
    </main>
  );
}
