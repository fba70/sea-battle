'use client';

import { useTranslations } from 'next-intl';

import { FLEET } from '@/game/constants';
import type { ShipClass } from '@/game/types';

export function FleetTray({
  remaining,
  selected,
  onSelect,
  onBeginDrag,
}: {
  remaining: ReadonlyMap<ShipClass, number>;
  selected: ShipClass | null;
  onSelect: (shipClass: ShipClass) => void;
  onBeginDrag: (shipClass: ShipClass) => void;
}) {
  const t = useTranslations('game');

  return (
    <ul className="flex flex-col gap-1.5" aria-label={t('placement.fleetTray')}>
      {FLEET.map((entry) => {
        const left = remaining.get(entry.shipClass) ?? 0;
        const active = selected === entry.shipClass;
        const exhausted = left === 0;

        return (
          <li key={entry.shipClass}>
            <button
              type="button"
              disabled={exhausted}
              aria-pressed={active}
              onPointerDown={() => {
                if (!exhausted) onBeginDrag(entry.shipClass);
              }}
              onClick={() => {
                if (!exhausted) onSelect(entry.shipClass);
              }}
              className={[
                // touch-pan-y, not touch-none: `touch-action: none` stopped the page
                // scrolling whenever a touch began on a tray row, and the tray covers
                // a third of the placement screen on a phone (§7.10).
                'flex w-full touch-pan-y items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left',
                'transition-[background-color,border-color,opacity] duration-150',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none',
                exhausted
                  ? 'cursor-not-allowed border-border/50 opacity-40'
                  : 'cursor-grab hover:border-primary/60 hover:bg-primary/5 active:scale-[0.99]',
                active && !exhausted
                  ? 'border-primary bg-primary/15 shadow-[inset_2px_0_0_0_var(--color-primary)]'
                  : 'border-border bg-card',
              ].join(' ')}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{t(`ship.${entry.shipClass}`)}</span>
                <span className="text-xs text-muted-foreground">
                  {t('placement.deckCount', { count: entry.size })}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-2">
                <span aria-hidden className="flex gap-0.5">
                  {Array.from({ length: entry.size }, (_, index) => (
                    <span
                      key={index}
                      className={[
                        'block size-2.5 rounded-[3px] transition-colors',
                        exhausted ? 'bg-muted-foreground/30' : 'bg-primary/85',
                      ].join(' ')}
                    />
                  ))}
                </span>
                <span
                  className={`w-16 text-right text-xs tabular-nums ${
                    exhausted ? 'text-muted-foreground/70' : 'font-medium text-foreground'
                  }`}
                >
                  {exhausted ? t('placement.done') : t('shipsLeftShort', { count: left })}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
