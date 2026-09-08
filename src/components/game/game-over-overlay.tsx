'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export function GameOverOverlay({ won, onRestart }: { won: boolean; onRestart: () => void }) {
  const t = useTranslations('game');
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      role="alertdialog"
      aria-modal="false"
      aria-label={won ? t('status.won') : t('status.lost')}
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.25 }}
      className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/85 p-6 backdrop-blur-sm"
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.3, ease: 'easeOut' }}
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 text-center shadow-xl"
      >
        <h2 className={`text-2xl font-semibold ${won ? 'text-primary' : 'text-destructive'}`}>
          {won ? t('status.won') : t('status.lost')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {won ? t('result.wonBody') : t('result.lostBody')}
        </p>

        <div className="flex w-full flex-col gap-2 sm:flex-row">
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
