/**
 * Deterministic PRNG (mulberry32). The engine never touches `Math.random`, so
 * every RNG-driven outcome — auto-placement today, bot moves later — is
 * reproducible from a seed the server owns (spec §5.3: RNG lives server-side).
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  /** Uniformly picks one element; throws on an empty list. */
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`nextInt requires a positive integer bound, got ${maxExclusive}`);
    }
    return Math.floor(next() * maxExclusive);
  };

  return {
    next,
    nextInt,
    pick<T>(items: readonly T[]): T {
      const item = items[nextInt(items.length)];
      if (item === undefined) {
        throw new RangeError('Cannot pick from an empty list');
      }
      return item;
    },
  };
}
