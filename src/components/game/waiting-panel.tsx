'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

import { HeroGrid } from '@/components/hero-grid';

export type WaitingTone = 'waiting' | 'connecting' | 'problem';

const RING: Record<WaitingTone, string> = {
  waiting: 'border-primary/40 bg-primary/10 text-primary',
  connecting: 'border-border bg-muted text-muted-foreground',
  problem: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const DOT: Record<WaitingTone, string> = {
  waiting: 'bg-primary',
  connecting: 'bg-muted-foreground',
  problem: 'bg-destructive',
};

/**
 * A sonar sweep: one ring expanding out of the centre dot.
 *
 * Deliberately the only motion on these screens — it reads as "listening" rather than
 * "loading", which is what waiting for an opponent actually is. Removed entirely under
 * reduced motion, where the static dot alone carries the state.
 */
function Sonar({ tone }: { tone: WaitingTone }) {
  const reduceMotion = useReducedMotion();

  return (
    <span className="relative flex size-3 shrink-0" aria-hidden>
      {tone !== 'problem' && !reduceMotion ? (
        <motion.span
          className={`absolute inline-flex size-full rounded-full ${DOT[tone]}`}
          animate={{ opacity: [0.55, 0, 0.55], scale: [1, 2.6, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
        />
      ) : null}
      <span className={`relative inline-flex size-3 rounded-full ${DOT[tone]}`} />
    </span>
  );
}

/**
 * The shared look for every "nothing to do yet" state: waiting for an opponent to
 * join, waiting for them to place their fleet, searching for a quick match, or
 * reconnecting.
 *
 * These used to be bare paragraphs, which read as unfinished rather than as part of
 * the game. Same tokens and grid motif as the rest of the site, no heavy animation.
 */
export function WaitingPanel({
  tone = 'waiting',
  title,
  description,
  status,
  children,
  actions,
}: {
  tone?: WaitingTone;
  title: string;
  description?: string;
  /** Short live-region line, e.g. "Waiting for your opponent…". */
  status?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="relative mx-auto flex w-full max-w-md flex-col items-center overflow-hidden rounded-xl border border-border bg-card px-6 py-10 text-center sm:py-8">
      {/*
        Confined to the top of the card and faded out: at full height it sat behind the
        body copy and made it harder to read.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 overflow-hidden">
        <HeroGrid className="absolute -top-24 left-1/2 h-[20rem] w-[20rem] -translate-x-1/2 opacity-30" />
      </div>

      <div className="relative flex w-full flex-col items-center gap-4 sm:gap-3.5">
        <span
          className={`flex size-14 items-center justify-center rounded-full border sm:size-12 ${RING[tone]}`}
        >
          <Sonar tone={tone} />
        </span>

        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold tracking-tight text-balance">{title}</h2>
          {description ? (
            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        {status ? (
          <p role="status" aria-live="polite" className="text-sm font-medium text-muted-foreground">
            {status}
          </p>
        ) : null}

        {children ? <div className="w-full">{children}</div> : null}
        {actions ? <div className="flex w-full flex-col gap-2 sm:flex-row">{actions}</div> : null}
      </div>
    </section>
  );
}
