'use client';

import { useReducedMotion } from 'motion/react';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { LEADERBOARD_MIN_RATED_GAMES } from '@/lib/rating/policy';
import type { RatingOutcome } from './use-live-match';

/**
 * What the match did to your rating (spec §7.6, §7.1's "rating delta counting
 * up/down").
 *
 * Shows nothing at all until the server has the numbers: the result appears the
 * instant the game ends, and this fills in a second later when the app has recorded
 * it. An unrated match says so rather than leaving a gap.
 */

/** How long the count takes. Short enough not to delay anyone reading the result. */
const COUNT_MS = 700;

/**
 * Counts from the pre-match rating to the new one.
 *
 * Returns the final value immediately under reduced motion — spec §7.1 asks for
 * "instant, non-flashing state updates" there, not a slower animation.
 */
function useCountUp(to: number, from: number): number {
  const reduceMotion = useReducedMotion();
  const [value, setValue] = useState(from);

  useEffect(() => {
    if (reduceMotion) {
      // Nothing to animate, and nothing to set: the final value is returned below.
      return;
    }

    let frame = 0;
    const started = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / COUNT_MS);
      // Ease out: the number slows as it arrives, which reads as settling.
      setValue(from + (to - from) * (1 - (1 - progress) ** 3));
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [to, from, reduceMotion]);

  return reduceMotion ? to : value;
}

export function RatingChange({ outcome }: { readonly outcome: RatingOutcome | null }) {
  const t = useTranslations('multiplayer.rating');
  const format = useFormatter();

  const summary = outcome?.rated === true ? outcome.summary : undefined;
  const target = summary ? Math.round(summary.rating) : 0;
  const start = summary ? Math.round(summary.rating - summary.delta) : 0;
  const shown = useCountUp(target, start);

  // Nothing known yet: the result is already on screen, and this appears when the
  // app has recorded the match.
  if (outcome === null) {
    return null;
  }

  if (!outcome.rated) {
    return <p className="text-sm text-muted-foreground">{t('unrated')}</p>;
  }

  if (!summary) {
    return null;
  }

  const delta = Math.round(summary.delta);
  const gained = delta >= 0;
  const remaining = Math.max(0, LEADERBOARD_MIN_RATED_GAMES - summary.gamesRated);

  return (
    <div className="flex flex-col items-center gap-1">
      <p className="flex items-baseline gap-2">
        <span
          className={`text-sm font-semibold tabular-nums ${
            gained ? 'text-primary' : 'text-destructive'
          }`}
        >
          {gained ? '+' : '−'}
          {format.number(Math.abs(delta))}
        </span>
        <span className="text-lg font-semibold tabular-nums">
          {format.number(Math.round(shown))}
        </span>
      </p>

      {remaining > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('provisional', {
            played: summary.gamesRated,
            total: LEADERBOARD_MIN_RATED_GAMES,
            remaining,
          })}
        </p>
      ) : null}
    </div>
  );
}
