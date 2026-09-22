'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, type KeyboardEvent } from 'react';

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
  const panel = useRef<HTMLDivElement>(null);

  /**
   * Keeps Tab inside the dialog. It covers the viewport on a phone, so letting
   * focus walk out to the board behind it would strand a keyboard or
   * screen-reader user somewhere they cannot see. This is also what makes the
   * aria-modal below truthful rather than decorative.
   */
  const trapFocus = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !panel.current) return;

    const focusable = panel.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const tally = [
    { key: 'shots', label: t('stats.shotsFired'), value: String(stats.shots) },
    { key: 'hits', label: t('stats.hits'), value: String(stats.hits) },
    { key: 'accuracy', label: t('stats.accuracy'), value: `${Math.round(stats.accuracy * 100)}%` },
  ];

  return (
    <motion.div
      role="alertdialog"
      aria-modal="true"
      onKeyDown={trapFocus}
      aria-label={won ? t('status.won') : t('status.lost')}
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.22 }}
      /*
       * Fixed on small screens so the result is centred on the viewport the
       * player is actually looking at: the board can be scrolled well out of
       * view on a phone, and an absolutely-positioned overlay centred on the
       * board went with it. From lg upward the whole play area is on screen at
       * once, so the overlay stays anchored to it as before.
       *
       * Padding carries the safe-area insets so the dialog clears the notch and
       * the home indicator when it covers the full screen.
       */
      className="fixed inset-0 z-30 flex items-center justify-center bg-background/70 p-4 backdrop-blur-[2px] lg:absolute lg:rounded-xl lg:bg-background/55"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
      }}
    >
      <motion.div
        ref={panel}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
        className={`flex max-h-full w-full max-w-sm flex-col gap-5 overflow-y-auto rounded-xl border-t-2 bg-card p-6 text-center shadow-2xl ${
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
