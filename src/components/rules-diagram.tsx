import type { Coord } from '@/game/types';

/**
 * Small static SVG diagrams for the How to Play page.
 *
 * They deliberately reuse the board's visual vocabulary — the same hull shape,
 * the same ring / burst / crossed-block marks — so what you learn here is what
 * you see in the game. Server-rendered and decorative: each diagram carries a
 * text alternative, and the surrounding copy states every rule on its own.
 */

interface Hull {
  readonly origin: Coord;
  readonly size: number;
  readonly orientation: 'horizontal' | 'vertical';
  readonly tone?: 'ship' | 'invalid';
}

function hullRect(hull: Hull, key: string) {
  const width = hull.orientation === 'horizontal' ? hull.size : 1;
  const height = hull.orientation === 'vertical' ? hull.size : 1;
  const invalid = hull.tone === 'invalid';

  return (
    <rect
      key={key}
      x={hull.origin.x + 0.14}
      y={hull.origin.y + 0.14}
      width={width - 0.28}
      height={height - 0.28}
      rx={0.26}
      className={
        invalid ? 'fill-destructive/35 stroke-destructive' : 'fill-primary/35 stroke-primary/90'
      }
      strokeWidth={0.07}
    />
  );
}

function Grid({ size }: { size: number }) {
  const lines = Array.from({ length: size - 1 }, (_, index) => index + 1);
  return (
    <g className="stroke-border" strokeWidth={0.02}>
      {lines.map((index) => (
        <line key={`v${index}`} x1={index} y1={0} x2={index} y2={size} />
      ))}
      {lines.map((index) => (
        <line key={`h${index}`} x1={0} y1={index} x2={size} y2={index} />
      ))}
    </g>
  );
}

function Frame({
  size,
  label,
  children,
}: {
  size: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="w-full max-w-[13rem] rounded-lg border border-border bg-[color-mix(in_oklab,var(--color-primary)_13%,var(--color-card))]"
    >
      <Grid size={size} />
      {children}
    </svg>
  );
}

/** Miss ring, hit burst, sunk block — identical to the in-game marks. */
function MissMark({ at }: { at: Coord }) {
  return (
    <circle
      cx={at.x + 0.5}
      cy={at.y + 0.5}
      r={0.19}
      className="fill-none stroke-muted-foreground"
      strokeWidth={0.075}
    />
  );
}

function KnownEmptyMark({ at }: { at: Coord }) {
  return <circle cx={at.x + 0.5} cy={at.y + 0.5} r={0.075} className="fill-muted-foreground/60" />;
}

function HitMark({ at }: { at: Coord }) {
  const cx = at.x + 0.5;
  const cy = at.y + 0.5;
  const points: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const radius = i % 2 === 0 ? 0.3 : 0.11;
    const angle = (Math.PI / 4) * i - Math.PI / 2;
    points.push(`${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)}`);
  }
  return <path d={`M${points.join(' L')} Z`} className="fill-accent" />;
}

function SunkMark({ at }: { at: Coord }) {
  const cx = at.x + 0.5;
  const cy = at.y + 0.5;
  return (
    <g>
      <rect
        x={at.x + 0.06}
        y={at.y + 0.06}
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
    </g>
  );
}

/** The whole fleet: 1x4, 2x3, 3x2, 4x1 (spec §4). */
export function FleetDiagram({ label }: { label: string }) {
  const hulls: Hull[] = [
    { origin: { x: 0, y: 0 }, size: 4, orientation: 'horizontal' },
    { origin: { x: 0, y: 2 }, size: 3, orientation: 'horizontal' },
    { origin: { x: 4, y: 2 }, size: 3, orientation: 'horizontal' },
    { origin: { x: 0, y: 4 }, size: 2, orientation: 'horizontal' },
    { origin: { x: 3, y: 4 }, size: 2, orientation: 'horizontal' },
    { origin: { x: 6, y: 4 }, size: 2, orientation: 'horizontal' },
    { origin: { x: 0, y: 6 }, size: 1, orientation: 'horizontal' },
    { origin: { x: 2, y: 6 }, size: 1, orientation: 'horizontal' },
    { origin: { x: 4, y: 6 }, size: 1, orientation: 'horizontal' },
    { origin: { x: 6, y: 6 }, size: 1, orientation: 'horizontal' },
  ];

  return (
    <Frame size={8} label={label}>
      {hulls.map((hull, i) => hullRect(hull, `f${i}`))}
    </Frame>
  );
}

/** Two ships with a clear cell between them — allowed. */
export function LegalPlacementDiagram({ label }: { label: string }) {
  return (
    <Frame size={5} label={label}>
      {hullRect({ origin: { x: 0, y: 1 }, size: 3, orientation: 'horizontal' }, 'a')}
      {hullRect({ origin: { x: 0, y: 3 }, size: 2, orientation: 'horizontal' }, 'b')}
    </Frame>
  );
}

/** Two ships meeting at a corner — rejected, because diagonals count as touching. */
export function IllegalPlacementDiagram({ label }: { label: string }) {
  return (
    <Frame size={5} label={label}>
      {hullRect({ origin: { x: 0, y: 1 }, size: 3, orientation: 'horizontal' }, 'a')}
      {hullRect(
        { origin: { x: 3, y: 2 }, size: 2, orientation: 'horizontal', tone: 'invalid' },
        'b',
      )}
    </Frame>
  );
}

/** What each mark on the firing grid means. */
export function OutcomesDiagram({ label }: { label: string }) {
  return (
    <Frame size={5} label={label}>
      <MissMark at={{ x: 1, y: 1 }} />
      <HitMark at={{ x: 3, y: 1 }} />
      <HitMark at={{ x: 1, y: 3 }} />
      <SunkMark at={{ x: 3, y: 3 }} />
    </Frame>
  );
}

/** A sunk two-cell ship with its auto-revealed buffer ring. */
export function BufferDiagram({ label }: { label: string }) {
  const buffer: Coord[] = [];
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 4; x += 1) {
      const onShip = y === 2 && (x === 2 || x === 3);
      if (!onShip) buffer.push({ x, y });
    }
  }

  return (
    <Frame size={6} label={label}>
      {buffer.map((cell) => (
        <KnownEmptyMark key={`${cell.x},${cell.y}`} at={cell} />
      ))}
      <SunkMark at={{ x: 2, y: 2 }} />
      <SunkMark at={{ x: 3, y: 2 }} />
    </Frame>
  );
}
