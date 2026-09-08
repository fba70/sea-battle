'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react';

import { BOARD_SIZE, COLUMN_LABELS } from '@/game/constants';
import type { Coord } from '@/game/types';
import { allCoords, coordLabel, markAt, type CellMark, type ShipOutline } from './board-model';
import { CellGlyph, ShipHull, SplashRipple } from './board-marks';

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
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>

      <div className="grid grid-cols-[0.9rem_minmax(0,1fr)] grid-rows-[1rem_auto] gap-0.5 sm:grid-cols-[1.25rem_minmax(0,1fr)] sm:gap-1">
        {/* Column labels A-J */}
        <div aria-hidden className="col-start-2 row-start-1 grid grid-cols-10 gap-px">
          {COLUMN_LABELS.map((label) => (
            <span
              key={label}
              className="text-center text-[0.625rem] leading-5 font-medium text-muted-foreground"
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
              className="flex items-center justify-center text-[0.625rem] font-medium text-muted-foreground"
            >
              {index + 1}
            </span>
          ))}
        </div>

        <motion.div
          className="relative col-start-2 row-start-2 aspect-square w-full overflow-hidden rounded-lg border border-border bg-[color-mix(in_oklab,var(--color-primary)_10%,var(--color-card))] shadow-inner"
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

            {ghost
              ? ghost.cells.map((cell) => (
                  <rect
                    key={`ghost-${cell.x},${cell.y}`}
                    x={cell.x + 0.08}
                    y={cell.y + 0.08}
                    width={0.84}
                    height={0.84}
                    rx={0.18}
                    className={
                      ghost.valid
                        ? 'fill-primary/45 stroke-primary'
                        : 'fill-destructive/40 stroke-destructive'
                    }
                    strokeWidth={0.06}
                  />
                ))
              : null}
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
