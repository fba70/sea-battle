import { defineRouting } from 'next-intl/routing';

/**
 * Spec §7.14: en, de, es, it, fr. English is the source and fallback locale.
 * Explicitly no Russian (spec §2, Non-Goal 6).
 *
 * Catalog review status
 * ---------------------
 * §7.14 requires a human review of German before the locale may be called
 * complete, and §13 ships English + German as the Phase 0 launch pair.
 *
 * - **en** — source of truth, complete.
 * - **de** — complete and **human-reviewed on 2026-09-22**. The reviewer settled
 *   the informal "du" voice, the Spielfeld/Feld/Raster vocabulary, "Wasser" for a
 *   miss with a separate term for untouched water, and the rule that ship names
 *   must stand on their own — German ship genders differ (das Schlachtschiff, der
 *   Kreuzer, der Zerstörer, das U-Boot), so no string may place an article or
 *   possessive before an interpolated {ship}. Twenty corrections were applied.
 * - **es / it / fr** — intentionally partial; missing keys fall back to English
 *   per §7.14. Filling them in is Phase 1 (§13).
 *
 * Any new German string must honour the conventions above.
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
