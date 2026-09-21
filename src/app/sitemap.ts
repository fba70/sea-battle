import type { MetadataRoute } from 'next';

import { locales } from '@/i18n/routing';
import { LOCALIZED_ROUTES, localizedPath, SITE_URL } from '@/lib/seo';

/**
 * Per-locale sitemap entries (spec §7.14). Every route is listed once per
 * locale, and each entry carries the hreflang alternates for its siblings so
 * crawlers can see the translation set from the sitemap alone.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return LOCALIZED_ROUTES.flatMap((route) =>
    locales.map((locale) => ({
      url: `${SITE_URL}${localizedPath(locale, route)}`,
      lastModified,
      changeFrequency: 'monthly' as const,
      // The landing page is the entry point; the rest are equal supporting pages.
      priority: route === '' ? 1 : 0.7,
      alternates: {
        languages: Object.fromEntries(
          locales.map((code) => [code, `${SITE_URL}${localizedPath(code, route)}`]),
        ),
      },
    })),
  );
}
