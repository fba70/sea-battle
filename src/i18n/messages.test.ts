import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import deMessages from '../../messages/de.json';
import enMessages from '../../messages/en.json';
import esMessages from '../../messages/es.json';
import frMessages from '../../messages/fr.json';
import itMessages from '../../messages/it.json';
import { mergeWithFallback, type MessageTree } from './merge';
import { locales, type Locale } from './routing';

type EnglishMessages = typeof enMessages;

const catalogs: Record<Locale, MessageTree> = {
  en: enMessages as MessageTree,
  de: deMessages as MessageTree,
  es: esMessages as MessageTree,
  it: itMessages as MessageTree,
  fr: frMessages as MessageTree,
};

function resolved(locale: Locale) {
  // After the fallback merge every English key is present, so the merged catalog
  // has the English catalog's shape.
  const messages = mergeWithFallback(catalogs.en, catalogs[locale]) as unknown as EnglishMessages;
  return createTranslator({ locale, messages });
}

function flatten(tree: MessageTree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : flatten(value, path);
  });
}

describe('message catalogs', () => {
  it('ships a catalog for every configured locale', () => {
    expect(Object.keys(catalogs).sort()).toEqual([...locales].sort());
  });

  it.each(locales.filter((locale) => locale !== 'en'))(
    'defines no keys in %s that do not exist in English',
    (locale) => {
      const englishKeys = new Set(flatten(catalogs.en));
      const orphans = flatten(catalogs[locale]).filter((key) => !englishKeys.has(key));

      expect(orphans).toEqual([]);
    },
  );

  it.each(locales)('resolves every English key in %s after fallback merge', (locale) => {
    const merged = mergeWithFallback(catalogs.en, catalogs[locale]);
    const missing = flatten(catalogs.en).filter((key) => !flatten(merged).includes(key));

    expect(missing).toEqual([]);
  });
});

describe('ICU pluralisation', () => {
  it('applies English plural rules', () => {
    const t = resolved('en');

    expect(t('game.shipsRemaining', { count: 0 })).toBe('No ships remaining');
    expect(t('game.shipsRemaining', { count: 1 })).toBe('1 ship remaining');
    expect(t('game.shipsRemaining', { count: 3 })).toBe('3 ships remaining');
  });

  it('applies German plural rules', () => {
    const t = resolved('de');

    expect(t('game.shipsRemaining', { count: 0 })).toBe('Keine Schiffe übrig');
    expect(t('game.shipsRemaining', { count: 1 })).toBe('1 Schiff übrig');
    expect(t('game.shipsRemaining', { count: 3 })).toBe('3 Schiffe übrig');
  });

  it('falls back to English for a namespace a locale has not translated yet', () => {
    // fr has no `game` namespace on purpose — this is the §7.14 fallback guarantee.
    expect(resolved('fr')('game.shipsRemaining', { count: 2 })).toBe('2 ships remaining');
    expect(resolved('fr')('landing.title')).toBe('Coulez la flotte.');
  });
});
