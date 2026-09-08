'use client';

import { motion } from 'motion/react';

import type { Coord } from '@/game/types';
import type { CellMark, ShipOutline } from './board-model';

const SPRING = { type: 'spring' as const, stiffness: 520, damping: 26 };

/**
 * Every mark is distinguished by SHAPE as well as colour (spec §7.1:
 * "colorblind-safe hit/miss encoding — shape + color, not color alone"):
 *
 *   miss        hollow ring
 *   known-empty small solid dot
 *   hit         four-point burst
 *   sunk        filled block with a cross
 */
export function CellGlyph({
  coord,
  mark,
  reduceMotion,
}: {
  coord: Coord;
  mark: CellMark;
  reduceMotion: boolean;
}) {
  const cx = coord.x + 0.5;
  const cy = coord.y + 0.5;

  const animation = reduceMotion
    ? { initial: false as const, animate: { opacity: 1, scale: 1 } }
    : {
        initial: { opacity: 0, scale: 0.35 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.6 },
        transition: SPRING,
      };

  if (mark === 'miss') {
    return (
      <motion.circle
        {...animation}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
        cx={cx}
        cy={cy}
        r={0.19}
        className="fill-none stroke-muted-foreground"
        strokeWidth={0.075}
      />
    );
  }

  if (mark === 'known-empty') {
    return (
      <motion.circle
        {...animation}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
        cx={cx}
        cy={cy}
        r={0.075}
        className="fill-muted-foreground/60"
      />
    );
  }

  if (mark === 'hit') {
    return (
      <motion.path
        {...animation}
        style={{ transformOrigin: `${cx}px ${cy}px` }}
        d={burstPath(cx, cy, 0.3, 0.11)}
        className="fill-accent stroke-accent-foreground/25"
        strokeWidth={0.02}
      />
    );
  }

  // sunk
  return (
    <motion.g {...animation} style={{ transformOrigin: `${cx}px ${cy}px` }}>
      <rect
        x={coord.x + 0.06}
        y={coord.y + 0.06}
        width={0.88}
        height={0.88}
        rx={0.14}
        className="fill-destructive/85"
      />
      <path
        d={`M${cx - 0.19} ${cy - 0.19} L${cx + 0.19} ${cy + 0.19} M${cx + 0.19} ${cy - 0.19} L${cx - 0.19} ${cy + 0.19}`}
        className="stroke-destructive-foreground"
        strokeWidth={0.08}
        strokeLinecap="round"
      />
    </motion.g>
  );
}

/** A four-point star, drawn from an outer and an inner radius. */
function burstPath(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 4) * i - Math.PI / 2;
    points.push(`${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)}`);
  }
  return `M${points.join(' L')} Z`;
}

/** The hull of a ship drawn as one rounded body spanning all of its cells. */
export function ShipHull({
  outline,
  reduceMotion,
}: {
  outline: ShipOutline;
  reduceMotion: boolean;
}) {
  const xs = outline.cells.map((cell) => cell.x);
  const ys = outline.cells.map((cell) => cell.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX + 1;
  const height = Math.max(...ys) - minY + 1;

  return (
    <motion.rect
      initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduceMotion ? { duration: 0 } : SPRING}
      style={{ transformOrigin: `${minX + width / 2}px ${minY + height / 2}px` }}
      x={minX + 0.14}
      y={minY + 0.14}
      width={width - 0.28}
      height={height - 0.28}
      rx={0.26}
      className={
        outline.sunk
          ? 'fill-destructive/25 stroke-destructive'
          : 'fill-primary/35 stroke-primary/90'
      }
      strokeWidth={0.07}
    />
  );
}

/** Water splash on a miss, impact ring on a hit. Skipped under reduced motion. */
export function SplashRipple({ coord, mark }: { coord: Coord; mark: CellMark }) {
  if (mark !== 'miss' && mark !== 'hit' && mark !== 'sunk') {
    return null;
  }

  return (
    <motion.circle
      initial={{ r: 0.08, opacity: 0.85 }}
      animate={{ r: 0.72, opacity: 0 }}
      transition={{ duration: mark === 'miss' ? 0.65 : 0.45, ease: 'easeOut' }}
      cx={coord.x + 0.5}
      cy={coord.y + 0.5}
      className={mark === 'miss' ? 'fill-none stroke-sky-300/70' : 'fill-none stroke-accent'}
      strokeWidth={0.06}
    />
  );
}
