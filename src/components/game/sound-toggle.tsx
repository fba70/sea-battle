'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useSound } from '@/lib/audio/use-audio';

export function SoundToggle({ className = '' }: { className?: string }) {
  const t = useTranslations('game.sound');
  const { muted, toggleMuted, play } = useSound();

  return (
    <button
      type="button"
      aria-pressed={muted}
      aria-label={muted ? t('unmute') : t('mute')}
      title={muted ? t('unmute') : t('mute')}
      onClick={() => {
        // Confirm the un-mute audibly; muting stays silent by definition.
        if (muted) play('click');
        toggleMuted();
      }}
      className={[
        'inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card',
        'text-muted-foreground transition-colors duration-150',
        'hover:border-primary/60 hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
        className,
      ].join(' ')}
    >
      {muted ? (
        <VolumeX aria-hidden className="size-4" />
      ) : (
        <Volume2 aria-hidden className="size-4" />
      )}
    </button>
  );
}
