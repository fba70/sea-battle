'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Resigning, with a confirmation step (spec §4: an explicit leave is an immediate
 * forfeit).
 *
 * Two-step rather than a dialog: the consequence is a loss and, in a rated game, a
 * rating hit, so it must not be one stray tap — but a modal over a live board hides
 * the thing the player is deciding about. The confirmation replaces the button in
 * place, moves focus to a deliberately non-destructive default, and times itself out
 * so an abandoned confirmation does not sit there waiting to be hit by accident.
 */
const CONFIRM_TIMEOUT_MS = 8_000;

export function ResignButton({
  onResign,
  disabled = false,
}: {
  readonly onResign: () => void;
  readonly disabled?: boolean;
}) {
  const t = useTranslations('multiplayer.resign');
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirming) {
      return;
    }
    // Focus lands on "keep playing", so a repeated Enter cannot resign the game.
    cancelRef.current?.focus();
    const timer = setTimeout(() => setConfirming(false), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        className="text-muted-foreground hover:text-destructive"
      >
        {t('action')}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('action')}>
      <span className="text-sm text-muted-foreground">{t('confirmQuestion')}</span>
      <Button
        ref={cancelRef}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setConfirming(false)}
      >
        {t('cancel')}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => {
          setConfirming(false);
          onResign();
        }}
      >
        {t('confirm')}
      </Button>
    </div>
  );
}
