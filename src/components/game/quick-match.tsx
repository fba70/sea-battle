'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ensureGuestSession } from '@/lib/guest-session';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { LiveMatchScreen } from './live-match-screen';
import { WaitingPanel } from './waiting-panel';

type QueueState =
  | { phase: 'idle' }
  | { phase: 'searching'; pool: 'rated' | 'unrated' | null }
  | { phase: 'matched'; gameId: string };

/**
 * How long to wait before asking again.
 *
 * A fixed 2s interval meant the player who did *not* win the pairing race kept
 * showing "searching" for a full interval after the other had already moved on — a
 * measured 1.8s of the two screens disagreeing. The pairing itself is correct and
 * unchanged; this only asks sooner in the window where a match is most likely, then
 * settles back so a long wait is not chatty.
 */
const POLL_DELAYS_MS = [600, 900, 1400, 2000];

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
    // See RoomMatch: the queue endpoint needs a session, and the guest one is
    // established asynchronously.
    await ensureGuestSession();

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

    /**
     * A self-scheduling chain, not `setInterval`.
     *
     * Each poll enqueues and then attempts a pairing, so two of them in flight at
     * once can have the same player claimed and re-queued by its own requests. An
     * interval fires regardless of whether the previous call finished, which under
     * load is exactly what happens; chaining guarantees one at a time.
     */
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let attempt = 0;

    const nextDelay = (): number =>
      POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)] as number;

    const tick = async (): Promise<void> => {
      await poll();
      attempt += 1;
      if (!stopped) {
        timer = setTimeout(() => void tick(), nextDelay());
      }
    };

    timer = setTimeout(() => void tick(), nextDelay());

    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
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
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-6">
      {state.phase === 'idle' ? (
        <WaitingPanel
          tone="connecting"
          title={t('idleTitle')}
          description={t('idleHint')}
          actions={
            <>
              <Button
                type="button"
                className="flex-1"
                onClick={() => {
                  searching.current = true;
                  setState({ phase: 'searching', pool: null });
                  void poll();
                }}
              >
                {t('start')}
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link href="/play">{t('backToMenu')}</Link>
              </Button>
            </>
          }
        />
      ) : (
        <WaitingPanel
          title={t('searchingTitle')}
          description={state.pool === 'unrated' ? t('poolUnrated') : t('searchingHint')}
          status={t('searching')}
          actions={
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                searching.current = false;
                void fetch('/api/match/quick', { method: 'DELETE' });
                setState({ phase: 'idle' });
              }}
            >
              {t('cancel')}
            </Button>
          }
        />
      )}
    </main>
  );
}
