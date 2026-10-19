import { hasLocale } from 'next-intl';

import { defaultLocale, routing, type Locale } from '@/i18n/routing';

/**
 * The cookie next-intl actually writes, read from the routing config rather than
 * spelled out here: the name is deliberately not the library default, and
 * hard-coding the default meant every email went out in English.
 */
const LOCALE_COOKIE =
  typeof routing.localeCookie === 'object' && typeof routing.localeCookie.name === 'string'
    ? routing.localeCookie.name
    : 'NEXT_LOCALE';

/**
 * Which language to write to someone in (spec §7.14: "rendered in the
 * recipient's `users.locale`").
 *
 * The stored preference wins. Failing that, the locale cookie the request
 * carries — which is what a brand-new account has, since nothing has saved a
 * preference for them yet and they are registering in whatever language they are
 * reading. English last.
 */
export function localeForEmail(user: unknown, request?: Request | undefined): Locale {
  // better-auth's user type covers its own columns, not the ones spec §6 adds, so
  // the preference is read defensively rather than cast into existence.
  const stored = (user as { locale?: unknown } | null)?.locale;

  if (typeof stored === 'string' && hasLocale(routing.locales, stored)) {
    return stored;
  }

  const cookie = request?.headers.get('cookie') ?? '';
  const match = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`).exec(cookie);
  const fromCookie = match?.[1];

  return fromCookie !== undefined && hasLocale(routing.locales, fromCookie)
    ? fromCookie
    : defaultLocale;
}
