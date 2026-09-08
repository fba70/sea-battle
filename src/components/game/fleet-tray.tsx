'use client';

import { useTranslations } from 'next-intl';

import { FLEET } from '@/game/constants';
import type { Orientation, ShipClass } from '@/game/types';

export function FleetTray({
  remaining,
  selected,
  orientation,
  onSelect,
  onBeginDrag,
}: {
  remaining: ReadonlyMap<ShipClass, number>;
  selected: ShipClass | null;
  orientation: Orientation;
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
                'flex w-full touch-none items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                exhausted
                  ? 'cursor-not-allowed border-border/60 opacity-45'
                  : 'cursor-grab hover:border-primary/70',
                active && !exhausted ? 'border-primary bg-primary/15' : 'border-border bg-card',
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
                        'block rounded-[2px]',
                        orientation === 'horizontal' && active ? 'h-3 w-2.5' : 'h-2.5 w-2.5',
                        exhausted ? 'bg-muted-foreground/40' : 'bg-primary/80',
                      ].join(' ')}
                    />
                  ))}
                </span>
                <span className="w-8 text-right text-sm tabular-nums text-muted-foreground">
                  {left}/{entry.count}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
