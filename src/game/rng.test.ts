import { describe, expect, it } from 'vitest';

import { createRng } from './rng';

describe('deterministic RNG', () => {
  it('produces the same sequence for the same seed', () => {
    const first = Array.from({ length: 20 }, () => createRng(1234).next());
    const second = Array.from({ length: 20 }, () => createRng(1234).next());

    expect(first).toEqual(second);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 10 }, (_, i) => createRng(1).nextInt(1000) + i);
    const rngB = createRng(2);
    const b = Array.from({ length: 10 }, (_, i) => rngB.nextInt(1000) + i);

    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('bounds nextInt to [0, max)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.nextInt(10);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(10);
    }
  });

  it('rejects a non-positive bound', () => {
    expect(() => createRng(1).nextInt(0)).toThrow(RangeError);
    expect(() => createRng(1).nextInt(-5)).toThrow(RangeError);
    expect(() => createRng(1).nextInt(1.5)).toThrow(RangeError);
  });

  it('refuses to pick from an empty list', () => {
    expect(() => createRng(1).pick([])).toThrow(RangeError);
  });
});
