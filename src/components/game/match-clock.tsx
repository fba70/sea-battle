'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/**
 * A countdown towards a server deadline (spec §4).
 *
 * Display only, and deliberately so: the number here is derived from the browser's
 * clock, while the server decides when a deadline has actually passed. A viewer whose
 * clock is off sees a slightly wrong countdown, never a wrong outcome — and the
 * server's own snapshot corrects the display a moment later.
 */

/** Milliseconds left, never negative. */
export function remainingMs(deadlineTs: number | null, now: number): number | null {
  return deadlineTs === null ? null : Math.max(0, deadlineTs - now);
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }
    // Twice a second, so the displayed second never lags by a visible amount while
    // still costing almost nothing.
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);

  return now;
}

export function formatSeconds(ms: number): string {
  return String(Math.ceil(ms / 1000));
}

export function MatchClock({
  deadlineTs,
  paused,
  label,
}: {
  readonly deadlineTs: number | null;
  readonly paused: boolean;
  /** Accessible description, e.g. "Time left this turn". */
  readonly label: string;
}) {
  const t = useTranslations('multiplayer.clock');
  const now = useNow(deadlineTs !== null && !paused);
  const left = remainingMs(deadlineTs, now);

  if (paused) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden />
        {t('paused')}
      </span>
    );
  }

  if (left === null) {
    return null;
  }

  const seconds = formatSeconds(left);
  // Ten seconds is where a player should feel it; the colour change is paired with
  // the text so it never carries the meaning on its own.
  const urgent = left <= 10_000;

  return (
    <span
      role="timer"
      aria-label={label}
      className={`inline-flex items-center gap-1.5 font-mono text-sm tabular-nums ${
        urgent ? 'font-semibold text-destructive' : 'text-muted-foreground'
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${urgent ? 'bg-destructive' : 'bg-muted-foreground'}`}
      />
      {t('seconds', { seconds })}
    </span>
  );
}

/**
 * The opponent's grace window, counted down for the player who is still here.
 *
 * Same contract as the move clock: this is what the waiting player sees, not what
 * decides the game.
 */
export function GraceCountdown({ deadlineTs }: { readonly deadlineTs: number }) {
  const t = useTranslations('multiplayer.clock');
  const now = useNow(true);
  const left = Math.max(0, deadlineTs - now);

  return (
    <span className="font-mono tabular-nums">{t('seconds', { seconds: formatSeconds(left) })}</span>
  );
}
