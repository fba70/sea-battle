import type { Metadata } from 'next';

import { defaultLocale, locales, type Locale } from '@/i18n/routing';

/**
 * Absolute origin used for canonical URLs, hreflang alternates and the sitemap.
 * Falls back to localhost so `next build` works without deployment config.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

/**
 * Every localized route, as a path under `/[locale]`. Single source of truth:
 * both the per-page metadata and the sitemap read from here, so a new page
 * cannot end up in one and not the other.
 */
export const LOCALIZED_ROUTES = ['', '/how-to-play', '/faq', '/play/bot'] as const;

export type LocalizedRoute = (typeof LOCALIZED_ROUTES)[number];

export function localizedPath(locale: Locale, route: LocalizedRoute | string): string {
  return `/${locale}${route}`;
}

/**
 * Per-route canonical plus hreflang alternates for all five locales (spec §7.14:
 * "`hreflang` alternates across all five locales").
 *
 * This must be set on every page: metadata set in the locale layout is inherited
 * by children, so a layout-level canonical would make /en/faq claim to be /en.
 */
export function alternatesFor(
  locale: Locale,
  route: LocalizedRoute | string,
): Metadata['alternates'] {
  return {
    canonical: localizedPath(locale, route),
    languages: {
      ...Object.fromEntries(locales.map((code) => [code, localizedPath(code, route)])),
      // Tells crawlers which version to serve when no locale matches.
      'x-default': localizedPath(defaultLocale, route),
    },
  };
}
