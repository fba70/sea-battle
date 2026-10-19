import { describe, expect, it } from 'vitest';

import {
  checkDisplayName,
  displayNameKey,
  normaliseDisplayName,
  suggestDisplayName,
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
} from './display-name';

describe('the agreed name rules', () => {
  it('accepts letters, numbers and underscores', () => {
    for (const name of ['Ada', 'ada_99', 'A_1', 'Captain_Nemo', 'XXXXXXXXXXXXXXXXXXXX']) {
      expect(checkDisplayName(name)).toEqual({ ok: true, name });
    }
  });

  it('holds the agreed length bounds', () => {
    expect(DISPLAY_NAME_MIN_LENGTH).toBe(3);
    expect(DISPLAY_NAME_MAX_LENGTH).toBe(20);
    expect(checkDisplayName('ab')).toEqual({ ok: false, problem: 'too_short' });
    expect(checkDisplayName('x'.repeat(21))).toEqual({ ok: false, problem: 'too_long' });
  });

  it.each([
    ['a space', 'Ada Lovelace'],
    ['punctuation', 'ada.lovelace'],
    ['a hyphen', 'ada-lovelace'],
    ['an emoji', 'ada🚢'],
    ['an accent', 'adá'],
  ])('rejects %s', (_label, name) => {
    expect(checkDisplayName(name)).toEqual({ ok: false, problem: 'invalid_characters' });
  });

  it('trims surrounding whitespace rather than rejecting it', () => {
    expect(checkDisplayName('  Ada  ')).toEqual({ ok: true, name: 'Ada' });
    expect(normaliseDisplayName('  Ada  ')).toBe('Ada');
  });

  it('refuses names that would impersonate a guest or the site', () => {
    // Every guest is called "Anonymous"; a registered player holding it would read
    // as a guest everywhere a name appears.
    for (const name of ['Anonymous', 'anonymous', 'ANONYMOUS', 'Guest', 'admin', 'SeaDuel']) {
      expect(checkDisplayName(name)).toEqual({ ok: false, problem: 'reserved' });
    }
  });
});

describe('uniqueness is case-insensitive', () => {
  it('folds case when comparing', () => {
    expect(displayNameKey('Ada')).toBe(displayNameKey('aDA'));
    expect(displayNameKey('  Ada ')).toBe('ada');
  });

  it('does not fold anything else', () => {
    expect(displayNameKey('ada_1')).not.toBe(displayNameKey('ada1'));
  });
});

describe('suggested names', () => {
  it('are always valid, for every point in the random range', () => {
    for (const r of [0, 0.01, 0.25, 0.5, 0.75, 0.999999]) {
      const suggestion = suggestDisplayName(() => r);
      expect(checkDisplayName(suggestion), suggestion).toEqual({ ok: true, name: suggestion });
    }
  });

  it('is pinned by its random source, so a test can predict it', () => {
    expect(suggestDisplayName(() => 0)).toBe('Skipper_1000');
  });
});
