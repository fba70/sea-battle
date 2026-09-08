'use client';

import { useTranslations } from 'next-intl';

import { BOT_DIFFICULTIES, type BotDifficulty } from '@/game/bot';

export function DifficultyPicker({
  value,
  onChange,
  disabled,
}: {
  value: BotDifficulty;
  onChange: (difficulty: BotDifficulty) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('game.difficulty');

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-sm font-medium text-muted-foreground">{t('label')}</legend>
      <div
        role="radiogroup"
        aria-label={t('label')}
        className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
      >
        {BOT_DIFFICULTIES.map((difficulty) => {
          const active = difficulty === value;
          return (
            <button
              key={difficulty}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(difficulty)}
              className={[
                'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-primary/10',
              ].join(' ')}
            >
              {t(difficulty)}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t(`${value}Hint`)}</p>
    </fieldset>
  );
}
