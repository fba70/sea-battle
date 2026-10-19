import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import de from '../../../messages/de.json';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
import fr from '../../../messages/fr.json';
// Renamed: `it` is the test function here.
import italian from '../../../messages/it.json';
import { mergeWithFallback, type MessageTree } from '@/i18n/merge';
import { locales, type Locale } from '@/i18n/routing';

const catalogs = { en, de, es, fr, it: italian } as unknown as Record<Locale, MessageTree>;

function translator(locale: Locale) {
  const messages = mergeWithFallback(catalogs.en, catalogs[locale]) as unknown as typeof en;
  return createTranslator({ locale, messages });
}

/**
 * The account page's introduction makes promises, so it has to keep up with what
 * the account system actually does (spec §7.5).
 */
describe('what the account page says it does', () => {
  const t = translator('en');

  it('names both ways to sign in', () => {
    expect(t('account.lead')).toMatch(/username/i);
    expect(t('account.emailOrUsername')).toMatch(/username/i);
  });

  it('no longer promises that we never send anything', () => {
    // Confirmation and password-reset messages exist now, so "no email from us"
    // would be untrue.
    expect(t('account.lead')).not.toMatch(/no email from us|nothing else/i);
  });

  it.each(locales)('%s offers the same field and introduction', (locale) => {
    const local = translator(locale);

    expect(local('account.lead')).toBeTruthy();
    expect(local('account.emailOrUsername')).toBeTruthy();

    if (locale !== 'en') {
      // Translated, not quietly falling back to English.
      expect(local('account.lead')).not.toBe(t('account.lead'));
    }
  });
});
