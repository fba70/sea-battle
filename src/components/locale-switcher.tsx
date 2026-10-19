'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { usePathname, useRouter } from '@/i18n/navigation';
import { locales, localeNames, type Locale } from '@/i18n/routing';

/** Saves the choice against the account, for anyone who has one. */
async function rememberLocale(locale: Locale): Promise<void> {
  try {
    await fetch('/api/account/locale', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    });
  } catch {
    // Signed out, offline, or the write failed: the cookie still holds the choice
    // for this browser, which is all this page needs.
  }
}

/**
 * Spec §7.14: a visible language switcher that persists the choice.
 *
 * next-intl writes the locale cookie, which is what a guest's choice rides on.
 * For anyone with a session the choice is also saved against their account, so it
 * follows them to another device — §7.14 puts `users.locale` ahead of the cookie
 * in the detection order.
 *
 * The save is deliberately not awaited and its failure is ignored: switching
 * language must not wait on, or be blocked by, a write that only matters next
 * time. The cookie has already done the job for this browser.
 */
export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('locale');
  const [isPending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t('switcher')}</span>
      <select
        aria-label={t('switcher')}
        className="rounded-md border border-border bg-card px-2 py-1 text-sm disabled:opacity-60"
        defaultValue={locale}
        disabled={isPending}
        onChange={(event) => {
          const next = event.target.value as Locale;
          void rememberLocale(next);
          startTransition(() => {
            router.replace(pathname, { locale: next });
          });
        }}
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {localeNames[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
