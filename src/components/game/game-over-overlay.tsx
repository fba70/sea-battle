'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export interface GameOverStats {
  readonly shots: number;
  readonly hits: number;
  readonly accuracy: number;
  readonly shipsLeft: number;
}

export function GameOverOverlay({
  won,
  stats,
  onRestart,
}: {
  won: boolean;
  stats: GameOverStats;
  onRestart: () => void;
}) {
  const t = useTranslations('game');
  const reduceMotion = useReducedMotion();

  const tally = [
    { key: 'shots', label: t('stats.shotsFired'), value: String(stats.shots) },
    { key: 'hits', label: t('stats.hits'), value: String(stats.hits) },
    { key: 'accuracy', label: t('stats.accuracy'), value: `${Math.round(stats.accuracy * 100)}%` },
  ];

  return (
    <motion.div
      role="alertdialog"
      aria-modal="false"
      aria-label={won ? t('status.won') : t('status.lost')}
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.22 }}
      // Deliberately light: the final boards stay readable underneath, which is
      // half the reward of finishing a game.
      className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-background/55 p-4 backdrop-blur-[2px]"
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
        className={`flex w-full max-w-sm flex-col gap-5 rounded-xl border-t-2 bg-card p-6 text-center shadow-2xl ${
          won ? 'border-t-primary' : 'border-t-destructive'
        } border-x border-b border-border`}
      >
        <div className="flex flex-col gap-1.5">
          <h2
            className={`text-2xl font-semibold tracking-tight text-balance ${
              won ? 'text-primary' : 'text-destructive'
            }`}
          >
            {won ? t('result.wonTitle') : t('result.lostTitle')}
          </h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {won ? t('result.wonBody') : t('result.lostBody')}
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-2 border-y border-border py-3">
          {tally.map((item) => (
            <div key={item.key} className="flex flex-col gap-1">
              <dt className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">
                {item.label}
              </dt>
              <dd className="text-base leading-none font-semibold tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={onRestart} autoFocus>
            {t('action.playAgain')}
          </Button>
          <Button asChild variant="outline" className="flex-1">
            <Link href="/">{t('action.backHome')}</Link>
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
