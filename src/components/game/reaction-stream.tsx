'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { REACTION_LABEL_KEYS, type Reaction } from '@/server/session/reactions';

/** One reaction currently on screen. */
export interface FloatingReaction {
  readonly id: number;
  readonly emoji: Reaction;
  readonly mine: boolean;
}

/**
 * Reactions floating over the board (spec §7.1: "float-and-fade over the board").
 *
 * Never interactive and never in the way: the layer ignores pointer events
 * entirely, so a reaction drifting across a cell cannot swallow the shot aimed at
 * it. Your own reactions rise on your side, your opponent's on theirs, which is
 * enough to tell them apart without a label.
 *
 * Under reduced motion they appear and fade in place rather than travelling —
 * spec §7.1 asks for instant, non-flashing updates there.
 */
const LIFETIME_MS = 1_500;

export function ReactionStream({ reactions }: { readonly reactions: readonly FloatingReaction[] }) {
  const t = useTranslations('multiplayer.reactions');
  const reduceMotion = useReducedMotion();

  return (
    <>
      <div
        aria-hidden
        // Same convention as `data-cell` and `data-hull`: a stable hook for tests
        // that does not pretend to be semantics.
        data-reaction-stream
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      >
        <AnimatePresence>
          {reactions.map((reaction) => (
            <motion.span
              key={reaction.id}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 10, scale: reduceMotion ? 1 : 0.8 }}
              animate={{ opacity: 1, y: reduceMotion ? 0 : -70, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: reduceMotion ? 0.2 : LIFETIME_MS / 1000,
                ease: 'easeOut',
              }}
              className={`absolute bottom-6 text-3xl ${reaction.mine ? 'left-8' : 'right-8'}`}
            >
              {reaction.emoji}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      {/*
        Announced politely, so a screen reader hears "Opponent reacted: applause"
        between other updates rather than interrupting a turn.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {reactions.length === 0
          ? ''
          : t(reactions[reactions.length - 1]?.mine ? 'sentAnnounce' : 'receivedAnnounce', {
              emoji: t(
                `emoji.${REACTION_LABEL_KEYS[reactions[reactions.length - 1]?.emoji as Reaction]}`,
              ),
            })}
      </p>
    </>
  );
}

export { LIFETIME_MS as REACTION_LIFETIME_MS };
