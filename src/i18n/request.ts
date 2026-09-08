import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { mergeWithFallback, type MessageTree } from './merge';
import { defaultLocale, routing } from './routing';

async function loadCatalog(locale: string): Promise<MessageTree> {
  const catalog = (await import(`../../messages/${locale}.json`)) as { default: MessageTree };
  return catalog.default;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : defaultLocale;

  const fallbackMessages = await loadCatalog(defaultLocale);
  const messages =
    locale === defaultLocale
      ? fallbackMessages
      : mergeWithFallback(fallbackMessages, await loadCatalog(locale));

  return {
    locale,
    messages,
    // Server-rendered times are formatted in the viewer's zone client-side; pin a
    // stable default so SSR and hydration agree (spec §7.14 date/number formatting).
    timeZone: 'UTC',
  };
});
