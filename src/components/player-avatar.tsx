/**
 * A deterministic generated avatar (spec §7.5).
 *
 * §7.5 suggests boring-avatars or DiceBear. Both are runtime dependencies for what is
 * ultimately two derived numbers and a pair of initials, so this draws it locally
 * instead: the seed picks a hue, and the player's initials sit on it. Same seed, same
 * avatar, on the server and the client — no hydration mismatch and no network call.
 *
 * Swapping in a real avatar library later is a change to this component alone.
 */

/** FNV-1a: small, stable across platforms, and good enough to spread hues. */
function hashOf(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Up to two initials, from a display name that may be a single word or empty. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    return (words[0] as string).slice(0, 2).toUpperCase();
  }
  return `${(words[0] as string)[0]}${(words[words.length - 1] as string)[0]}`.toUpperCase();
}

export function PlayerAvatar({
  name,
  seed,
  className = 'size-9 text-xs',
}: {
  readonly name: string;
  /** Spec §6's `avatar_seed`; the name keeps it stable before one is assigned. */
  readonly seed?: string | null;
  readonly className?: string;
}) {
  const hash = hashOf(seed ?? name ?? '');
  const hue = hash % 360;

  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full border font-semibold tracking-wide ${className}`}
      style={{
        // Fixed saturation and lightness so every avatar carries the same weight
        // against the dark surface and the initials always stay readable.
        backgroundColor: `hsl(${hue} 45% 22%)`,
        borderColor: `hsl(${hue} 50% 42%)`,
        color: `hsl(${hue} 70% 82%)`,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
