import { describe, expect, it } from 'vitest';

import { mergeWithFallback } from './merge';

describe('mergeWithFallback', () => {
  it('keeps translated values from the target locale', () => {
    const merged = mergeWithFallback({ nav: { play: 'Play' } }, { nav: { play: 'Spielen' } });

    expect(merged).toEqual({ nav: { play: 'Spielen' } });
  });

  it('falls back to English for keys the locale has not translated yet', () => {
    const merged = mergeWithFallback(
      { nav: { play: 'Play', leaderboard: 'Leaderboard' } },
      { nav: { play: 'Jugar' } },
    );

    expect(merged).toEqual({ nav: { play: 'Jugar', leaderboard: 'Leaderboard' } });
  });

  it('merges nested namespaces without dropping sibling branches', () => {
    const merged = mergeWithFallback(
      { landing: { title: 'Sea Battle', cta: 'Play now' }, footer: { support: 'Support' } },
      { landing: { title: 'Bataille navale' } },
    );

    expect(merged).toEqual({
      landing: { title: 'Bataille navale', cta: 'Play now' },
      footer: { support: 'Support' },
    });
  });

  it('does not mutate the English catalog', () => {
    const english = { nav: { play: 'Play' } };
    mergeWithFallback(english, { nav: { play: 'Spielen' } });

    expect(english).toEqual({ nav: { play: 'Play' } });
  });
});
