import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import de from '../../messages/de.json';
import en from '../../messages/en.json';
import { mergeWithFallback, type MessageTree } from '@/i18n/merge';
import { locales, type Locale } from '@/i18n/routing';
import { FAQ_KEYS } from './faq-accordion';

const catalogs = { en, de } as unknown as Record<'en' | 'de', MessageTree>;

function translator(locale: Locale) {
  const messages = mergeWithFallback(
    catalogs.en,
    (catalogs as Record<string, MessageTree>)[locale] ?? catalogs.en,
  ) as unknown as typeof en;
  return createTranslator({ locale, messages });
}

/** Every heading and body the two content pages render. */
const HOW_TO_PLAY_KEYS = [
  'howToPlay.title',
  'howToPlay.intro',
  'howToPlay.goal.title',
  'howToPlay.goal.body',
  'howToPlay.place.title',
  'howToPlay.place.board',
  'howToPlay.place.orientation',
  'howToPlay.place.fleetDiagram',
  'howToPlay.place.fleet.four',
  'howToPlay.place.fleet.three',
  'howToPlay.place.fleet.two',
  'howToPlay.place.fleet.one',
  'howToPlay.touching.title',
  'howToPlay.touching.body',
  'howToPlay.touching.diagonals',
  'howToPlay.touching.help',
  'howToPlay.touching.allowed',
  'howToPlay.touching.notAllowed',
  'howToPlay.fire.title',
  'howToPlay.fire.turns',
  'howToPlay.fire.againLead',
  'howToPlay.fire.again',
  'howToPlay.fire.noRepeat',
  'howToPlay.sink.title',
  'howToPlay.sink.body',
  'howToPlay.sink.buffer',
  'howToPlay.sink.win',
  'howToPlay.bots.title',
  'howToPlay.salvo.title',
  'howToPlay.salvo.badge',
  'howToPlay.salvo.body',
  'howToPlay.cta',
  'howToPlay.faqLink',
  'faq.title',
  'faq.intro',
  'faq.cta',
  'faq.rulesLink',
  'nav.howToPlay',
  'nav.faq',
  'nav.label',
  'nav.footerLabel',
] as const;

describe.each(['en', 'de'] as const)('%s content', (locale) => {
  const t = translator(locale);

  it('defines every string the pages render', () => {
    for (const key of HOW_TO_PLAY_KEYS) {
      const value = t(key as never) as string;
      expect(value, `${key} is missing in ${locale}`).toBeTruthy();
      expect(value.startsWith('howToPlay.'), `${key} fell through in ${locale}`).toBe(false);
    }
  });

  it('answers every FAQ question from spec §7.9', () => {
    for (const key of FAQ_KEYS) {
      const question = t(`faq.items.${key}.q` as never) as string;
      const answer = t(`faq.items.${key}.a` as never) as string;

      expect(question, `${key} question missing in ${locale}`).toBeTruthy();
      expect(answer, `${key} answer missing in ${locale}`).toBeTruthy();
      expect(question.endsWith('?'), `${key} should read as a question`).toBe(true);
    }
  });

  it('writes bot descriptions for all three difficulties', () => {
    for (const level of ['easy', 'medium', 'hard']) {
      expect(t(`howToPlay.bots.${level}.name` as never)).toBeTruthy();
      expect(t(`howToPlay.bots.${level}.body` as never)).toBeTruthy();
    }
  });
});

describe('FAQ question set', () => {
  it('covers the questions spec §7.9 names', () => {
    // registration optional / is it free / bot / play a friend / mobile /
    // how rating works / account + data handling.
    expect([...FAQ_KEYS]).toEqual([
      'registration',
      'free',
      'bot',
      'friend',
      'mobile',
      'rating',
      'data',
    ]);
  });

  it('is fully translated into German, not left falling back', () => {
    const english = translator('en');
    const german = translator('de');

    for (const key of FAQ_KEYS) {
      expect(german(`faq.items.${key}.q` as never)).not.toBe(
        english(`faq.items.${key}.q` as never),
      );
    }
  });
});

describe('other locales still fall back to English', () => {
  it.each(locales.filter((locale) => locale !== 'en' && locale !== 'de'))(
    '%s renders English content without throwing',
    (locale) => {
      const t = translator(locale);
      expect(t('howToPlay.title' as never)).toBe('How to play');
      expect(t('faq.items.free.q' as never)).toBe('Is it free?');
    },
  );
});
