'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';

import type { MatchLogEntry } from '@/game/match/bot-match';
import { coordLabel } from './board-model';

export function TurnBanner({
  state,
}: {
  state: 'placement' | 'yours' | 'opponent' | 'won' | 'lost';
}) {
  const t = useTranslations('game.status');
  const reduceMotion = useReducedMotion();

  const tone: Record<typeof state, string> = {
    placement: 'border-border bg-card text-foreground',
    yours: 'border-primary/70 bg-primary/15 text-foreground',
    opponent: 'border-accent/60 bg-accent/10 text-foreground',
    won: 'border-primary bg-primary/25 text-foreground',
    lost: 'border-destructive/70 bg-destructive/15 text-foreground',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${tone[state]}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={reduceMotion ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
        >
          {t(state)}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

export function MoveLog({ log }: { log: readonly MatchLogEntry[] }) {
  const t = useTranslations('game');
  const recent = [...log].reverse().slice(0, 6);

  return (
    <section aria-label={t('log.title')} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">{t('log.title')}</h3>

      {recent.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('log.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {recent.map((entry) => (
            <li key={entry.seq} className="flex items-baseline gap-2 text-xs">
              <span
                className={
                  entry.actor === 'human'
                    ? 'w-14 shrink-0 font-medium text-primary'
                    : 'w-14 shrink-0 font-medium text-accent'
                }
              >
                {t(`log.${entry.actor}`)}
              </span>
              <span className="font-mono tabular-nums">{coordLabel(entry.coord)}</span>
              <span className="text-muted-foreground">
                {entry.sunkShipClass
                  ? t('log.sunk', { ship: t(`ship.${entry.sunkShipClass}`) })
                  : t(`log.${entry.outcome}`)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
