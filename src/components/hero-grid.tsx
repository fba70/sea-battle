/**
 * A static 10x10 grid echoing the game board, used as a quiet backdrop on the
 * landing page. Purely decorative: no animation, no interactivity, aria-hidden.
 */
export function HeroGrid({ className = '' }: { className?: string }) {
  const lines = Array.from({ length: 9 }, (_, index) => index + 1);

  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 10 10"
      className={`pointer-events-none select-none ${className}`}
    >
      <defs>
        <radialGradient id="hero-fade" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="white" stopOpacity="0.85" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id="hero-mask">
          <rect x="0" y="0" width="10" height="10" fill="url(#hero-fade)" />
        </mask>
      </defs>

      <g mask="url(#hero-mask)">
        <g className="stroke-primary/45" strokeWidth={0.02}>
          {lines.map((index) => (
            <line key={`v${index}`} x1={index} y1={0} x2={index} y2={10} />
          ))}
          {lines.map((index) => (
            <line key={`h${index}`} x1={0} y1={index} x2={10} y2={index} />
          ))}
        </g>

        {/* A couple of hulls and a hit marker, so the motif reads as a board. */}
        <rect x={1.15} y={2.15} width={2.7} height={0.7} rx={0.3} className="fill-primary/25" />
        <rect x={6.15} y={5.15} width={0.7} height={3.7} rx={0.3} className="fill-primary/25" />
        <circle cx={4.5} cy={6.5} r={0.16} className="fill-muted-foreground/40" />
        <circle cx={7.5} cy={2.5} r={0.16} className="fill-muted-foreground/40" />
        <circle cx={6.5} cy={6.5} r={0.2} className="fill-accent/50" />
      </g>
    </svg>
  );
}
