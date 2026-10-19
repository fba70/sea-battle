'use client';

import { Smile } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { REACTIONS, REACTION_LABEL_KEYS, type Reaction } from '@/server/session/reactions';

/**
 * Sending a reaction (spec §7.4).
 *
 * Desktop shows the six as a quiet row: they are a small social gesture, not a
 * control, so they sit at the weight of secondary text until hovered. On a phone
 * the row would compete with the firing area for thumb space, so it hides behind
 * one button and closes again as soon as something is sent.
 *
 * The server decides whether a reaction is actually relayed (spec §10). The brief
 * disable here is only so rapid tapping feels intentional rather than broken — it
 * is not the limit, and it is not trusted to be.
 *
 * Where this sits on the page is provisional — see the note at its call site in
 * `live-match-screen.tsx`. Spec §7.11's side panel is a Phase 2 redesign.
 */
const TAP_COOLDOWN_MS = 600;

export function ReactionBar({ onReact }: { readonly onReact: (emoji: Reaction) => void }) {
  const t = useTranslations('multiplayer.reactions');
  const [open, setOpen] = useState(false);
  const [resting, setResting] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  function send(emoji: Reaction): void {
    onReact(emoji);
    setResting(true);
    timers.current.push(
      setTimeout(() => setResting(false), TAP_COOLDOWN_MS),
      // On mobile the row is a popover; sending is the end of that interaction.
      setTimeout(() => setOpen(false), 200),
    );
  }

  const buttons = (
    <ul className="flex items-center gap-1" aria-label={t('label')}>
      {REACTIONS.map((emoji) => (
        <li key={emoji}>
          <button
            type="button"
            onClick={() => send(emoji)}
            disabled={resting}
            aria-label={t(`emoji.${REACTION_LABEL_KEYS[emoji]}`)}
            className="flex size-9 items-center justify-center rounded-md text-lg transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
          >
            <span aria-hidden>{emoji}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex items-center gap-2">
      {/* Phone: one button, opening the row above the fold of the controls. */}
      <div className="relative sm:hidden">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={t('label')}
          className="flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Smile aria-hidden className="size-4" />
        </button>

        {/*
          Opens downward and centred on the button: the bar lives in the top bar, so
          upward is off-screen, and anchoring to either edge pushed the row past the
          side of a narrow phone.
        */}
        {open ? (
          <div className="absolute top-full left-1/2 z-20 mt-2 -translate-x-1/2 rounded-lg border border-border bg-card p-1 shadow-lg">
            {buttons}
          </div>
        ) : null}
      </div>

      <div className="hidden sm:block">{buttons}</div>
    </div>
  );
}
