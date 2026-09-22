'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { BOARD_SIZE, COLUMN_LABELS } from '@/game/constants';
import type { Coord } from '@/game/types';
import { allCoords, coordLabel, markAt, type CellMark, type ShipOutline } from './board-model';
import { CellGlyph, GhostHull, ShipHull, SplashRipple } from './board-marks';

/**
 * Decision: ~33px cells at the 360px floor are accepted for Phase 0 (2026-09-22).
 *
 * §7.1 asks for touch targets of ≥40px on mobile, but ten columns need 400px of
 * width before labels or padding, so ≥40px is unreachable at the 360px viewport
 * §7.10 sets as the minimum. What §7.10 actually requires as acceptance — "the
 * full game (place, fire, win) is completable on a 360px-wide phone browser" — is
 * met and covered by E2E on mobile viewports.
 *
 * Measured: ~33px at 360px, ~36px at 390px (iPhone 12+), ~38px at 412px (Pixel).
 * All clear the WCAG 2.2 AA minimum target size of 24x24 CSS px. Touch-target
 * sizing gets revisited in the later production/design polish pass; do not
 * redesign the board for it now.
 */

export interface BoardInteraction {
  readonly cursor: Coord;
  readonly onCursorChange: (coord: Coord) => void;
  readonly onActivate: (coord: Coord) => void;
  readonly disabled?: boolean;
  /** Screen-reader description for a cell, e.g. "E5, unknown. Fire here." */
  readonly describeCell: (coord: Coord, mark: CellMark) => string;
  readonly onPointerEnterCell?: (coord: Coord) => void;
  readonly onPointerDownCell?: (coord: Coord, event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerLeaveBoard?: () => void;
}

export interface GhostPlacement {
  readonly cells: readonly Coord[];
  readonly valid: boolean;
}

export interface BoardProps {
  readonly title: string;
  readonly marks: readonly (readonly CellMark[])[];
  readonly outlines?: readonly ShipOutline[];
  readonly interaction?: BoardInteraction;
  readonly ghost?: GhostPlacement | null;
  /** Most recent shot on this board — drives the splash/impact animation. */
  readonly lastShot?: Coord | null;
  readonly invalidPulseKey?: number;
  readonly gridLabel: string;
  readonly className?: string;
  /** Draws attention to the board that is currently in play (spec §7.1 turn affordance). */
  readonly active?: boolean;
}

const AXIS = Array.from({ length: BOARD_SIZE }, (_, index) => index);

export function Board({
  title,
  marks,
  outlines = [],
  interaction,
  ghost,
  lastShot,
  invalidPulseKey,
  gridLabel,
  className = '',
  active = false,
}: BoardProps) {
  const reduceMotion = useReducedMotion();
  const gridRef = useRef<HTMLDivElement>(null);

  /** Moves both the visual cursor and DOM focus, so assistive tech follows along. */
  const moveCursor = useCallback(
    (coord: Coord) => {
      interaction?.onCursorChange(coord);
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-cell="${coord.x},${coord.y}"]`)
        ?.focus();
    },
    [interaction],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!interaction) return;

      const deltas: Record<string, Coord> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      const delta = deltas[event.key];

      if (delta) {
        event.preventDefault();
        moveCursor({
          x: Math.min(BOARD_SIZE - 1, Math.max(0, interaction.cursor.x + delta.x)),
          y: Math.min(BOARD_SIZE - 1, Math.max(0, interaction.cursor.y + delta.y)),
        });
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        moveCursor({ x: 0, y: interaction.cursor.y });
      } else if (event.key === 'End') {
        event.preventDefault();
        moveCursor({ x: BOARD_SIZE - 1, y: interaction.cursor.y });
      }
    },
    [interaction, moveCursor],
  );

  const ghostKeys = new Set(ghost?.cells.map((cell) => `${cell.x},${cell.y}`));

  return (
    <section className={`flex min-w-0 flex-col gap-2 ${className}`} aria-label={title}>
      <h2
        className={`text-xs font-semibold tracking-[0.12em] uppercase transition-colors ${
          active ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        {title}
      </h2>

      <div className="grid grid-cols-[0.9rem_minmax(0,1fr)] grid-rows-[1rem_auto] gap-0.5 sm:grid-cols-[1.25rem_minmax(0,1fr)] sm:gap-1">
        {/* Column labels A-J */}
        <div aria-hidden className="col-start-2 row-start-1 grid grid-cols-10 gap-px">
          {COLUMN_LABELS.map((label) => (
            <span
              key={label}
              className="text-center text-[0.6875rem] leading-4 font-medium text-muted-foreground/80 sm:leading-5"
            >
              {label}
            </span>
          ))}
        </div>

        {/* Row labels 1-10 */}
        <div aria-hidden className="col-start-1 row-start-2 grid grid-rows-10 gap-px">
          {AXIS.map((index) => (
            <span
              key={index}
              className="flex items-center justify-center text-[0.6875rem] font-medium text-muted-foreground/80"
            >
              {index + 1}
            </span>
          ))}
        </div>

        <motion.div
          className={[
            'relative col-start-2 row-start-2 aspect-square w-full overflow-hidden rounded-xl border',
            'bg-[color-mix(in_oklab,var(--color-primary)_13%,var(--color-card))] shadow-inner',
            'transition-[box-shadow,border-color] duration-200',
            active
              ? 'border-primary/60 shadow-[0_0_0_1px_var(--color-primary)] ring-1 ring-primary/25'
              : 'border-border',
          ].join(' ')}
          animate={invalidPulseKey && !reduceMotion ? { x: [0, -4, 4, -3, 3, 0] } : { x: 0 }}
          key={`shake-${invalidPulseKey ?? 0}`}
          transition={{ duration: 0.28 }}
        >
          <svg
            viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
            className="absolute inset-0 h-full w-full"
            aria-hidden
            focusable="false"
          >
            {/* Grid lines */}
            <g stroke="currentColor" className="text-border" strokeWidth={0.02} opacity={0.9}>
              {AXIS.slice(1).map((index) => (
                <line key={`v${index}`} x1={index} y1={0} x2={index} y2={BOARD_SIZE} />
              ))}
              {AXIS.slice(1).map((index) => (
                <line key={`h${index}`} x1={0} y1={index} x2={BOARD_SIZE} y2={index} />
              ))}
            </g>

            {outlines.map((outline) => (
              <ShipHull key={outline.id} outline={outline} reduceMotion={!!reduceMotion} />
            ))}

            <AnimatePresence initial={false}>
              {allCoords().map((coord) => {
                const mark = markAt(marks, coord);
                if (mark === 'water' || mark === 'ship') return null;
                return (
                  <CellGlyph
                    key={`${coord.x},${coord.y}-${mark}`}
                    coord={coord}
                    mark={mark}
                    reduceMotion={!!reduceMotion}
                  />
                );
              })}
            </AnimatePresence>

            {lastShot && !reduceMotion ? (
              <SplashRipple
                key={`ripple-${lastShot.x},${lastShot.y}-${markAt(marks, lastShot)}`}
                coord={lastShot}
                mark={markAt(marks, lastShot)}
              />
            ) : null}

            {/* One continuous hull, so the preview looks like the ship you will get. */}
            {ghost && ghost.cells.length > 0 ? <GhostHull ghost={ghost} /> : null}
          </svg>

          {/* Interaction + accessibility layer. Kept in HTML so every cell is a real
              focusable control with grid semantics, while the SVG stays presentational. */}
          <div
            ref={gridRef}
            role="grid"
            aria-label={gridLabel}
            aria-disabled={interaction?.disabled || undefined}
            onKeyDown={handleKeyDown}
            onPointerLeave={interaction?.onPointerLeaveBoard}
            className="absolute inset-0 grid grid-cols-10 grid-rows-10"
          >
            {AXIS.map((y) => (
              <div key={y} role="row" className="col-span-10 grid grid-cols-10">
                {AXIS.map((x) => {
                  const coord = { x, y };
                  const mark = markAt(marks, coord);
                  const isCursor = interaction?.cursor.x === x && interaction?.cursor.y === y;
                  const inGhost = ghostKeys.has(`${x},${y}`);

                  if (!interaction) {
                    return (
                      <div
                        key={x}
                        role="gridcell"
                        aria-label={`${coordLabel(coord)}, ${mark}`}
                        className="h-full w-full"
                      />
                    );
                  }

                  return (
                    <button
                      key={x}
                      type="button"
                      role="gridcell"
                      data-cell={`${x},${y}`}
                      aria-label={interaction.describeCell(coord, mark)}
                      tabIndex={isCursor ? 0 : -1}
                      disabled={interaction.disabled}
                      onFocus={() => interaction.onCursorChange(coord)}
                      onClick={() => interaction.onActivate(coord)}
                      onPointerEnter={() => interaction.onPointerEnterCell?.(coord)}
                      onPointerDown={(event) => interaction.onPointerDownCell?.(coord, event)}
                      className={[
                        'h-full w-full outline-none transition-colors',
                        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                        isCursor ? 'ring-1 ring-ring/45 ring-inset' : '',
                        interaction.disabled
                          ? 'cursor-default'
                          : inGhost
                            ? 'cursor-grabbing'
                            : 'cursor-crosshair hover:bg-primary/15',
                      ].join(' ')}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
