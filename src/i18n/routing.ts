import { defineRouting } from 'next-intl/routing';

/**
 * Spec §7.14: en, de, es, it, fr. English is the source and fallback locale.
 * Explicitly no Russian (spec §2, Non-Goal 6).
 */
export const locales = ['en', 'de', 'es', 'it', 'fr'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale = 'en' satisfies Locale;

/** Human-readable names, each written in its own language for the switcher. */
export const localeNames: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
  fr: 'Français',
};

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Path-based locale segment for every route (/en/play, /de/play) so <html lang>,
  // hreflang alternates and per-locale sitemaps are unambiguous. Spec §7.14.
  localePrefix: 'always',
  localeCookie: {
    name: 'SEADUEL_LOCALE',
    maxAge: 60 * 60 * 24 * 365,
  },
  // Detection order today: cookie -> Accept-Language -> defaultLocale.
  // users.locale slots in ahead of the cookie once accounts exist (spec §7.14).
  localeDetection: true,
});
