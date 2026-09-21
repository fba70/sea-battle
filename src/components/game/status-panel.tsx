'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';

import type { MatchLogEntry } from '@/game/match/bot-match';
import { coordLabel } from './board-model';

export type BannerState = 'placement' | 'yours' | 'opponent' | 'won' | 'lost';

const TONE: Record<BannerState, string> = {
  placement: 'border-border bg-card',
  yours: 'border-primary/60 bg-primary/12',
  opponent: 'border-accent/50 bg-accent/10',
  won: 'border-primary bg-primary/20',
  lost: 'border-destructive/60 bg-destructive/12',
};

const DOT: Record<BannerState, string> = {
  placement: 'bg-muted-foreground',
  yours: 'bg-primary',
  opponent: 'bg-accent',
  won: 'bg-primary',
  lost: 'bg-destructive',
};

/**
 * The single most important piece of chrome: whose turn it is, and what just
 * happened. A coloured status dot carries the same information as the tint, so
 * the state is never conveyed by colour alone.
 */
export function TurnBanner({ state, detail }: { state: BannerState; detail?: string | undefined }) {
  const t = useTranslations('game.status');
  const reduceMotion = useReducedMotion();
  const thinking = state === 'opponent';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`flex min-h-[3.25rem] items-center gap-3 rounded-xl border px-3.5 py-2.5 ${TONE[state]}`}
    >
      <span className="relative flex size-2.5 shrink-0">
        {thinking && !reduceMotion ? (
          <motion.span
            className={`absolute inline-flex size-full rounded-full ${DOT[state]}`}
            animate={{ opacity: [0.7, 0, 0.7], scale: [1, 2.2, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
          />
        ) : null}
        <span className={`relative inline-flex size-2.5 rounded-full ${DOT[state]}`} />
      </span>

      <div className="flex min-w-0 flex-col">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={state}
            initial={reduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            className="text-sm leading-tight font-semibold text-balance"
          >
            {t(state)}
          </motion.span>
        </AnimatePresence>

        {detail ? (
          <span className="truncate text-xs leading-tight text-muted-foreground">{detail}</span>
        ) : null}
      </div>
    </div>
  );
}

export function MoveLog({ log }: { log: readonly MatchLogEntry[] }) {
  const t = useTranslations('game');
  const reduceMotion = useReducedMotion();
  const recent = [...log].reverse().slice(0, 7);

  return (
    <section aria-label={t('log.title')} className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {t('log.title')}
      </h3>

      {recent.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('log.empty')}</p>
      ) : (
        <ol className="flex flex-col">
          <AnimatePresence initial={false}>
            {recent.map((entry) => (
              <motion.li
                key={entry.seq}
                layout={!reduceMotion}
                initial={reduceMotion ? false : { opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-baseline gap-2 border-b border-border/50 py-1 text-xs last:border-b-0"
              >
                <span
                  className={`w-9 shrink-0 font-medium ${
                    entry.actor === 'human' ? 'text-primary' : 'text-accent'
                  }`}
                >
                  {t(`log.${entry.actor}`)}
                </span>
                <span className="w-10 shrink-0 font-mono tabular-nums">
                  {coordLabel(entry.coord)}
                </span>
                <span
                  className={`min-w-0 truncate ${
                    entry.outcome === 'miss' ? 'text-muted-foreground' : 'text-foreground'
                  }`}
                >
                  {entry.sunkShipClass
                    ? t('log.sunk', { ship: t(`ship.${entry.sunkShipClass}`) })
                    : t(`log.${entry.outcome}`)}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}

/** Compact, fixed-height stat tiles that never ragged-wrap. */
export function StatTiles({
  items,
}: {
  items: readonly { key: string; label: string; value: string }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div
          key={item.key}
          className="flex min-h-[3.75rem] flex-col justify-between rounded-lg border border-border bg-card px-3 py-2"
        >
          <dt className="truncate text-[0.6875rem] tracking-wide text-muted-foreground uppercase">
            {item.label}
          </dt>
          <dd className="text-lg leading-none font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
