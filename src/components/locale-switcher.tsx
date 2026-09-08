'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { usePathname, useRouter } from '@/i18n/navigation';
import { locales, localeNames, type Locale } from '@/i18n/routing';

/**
 * Spec §7.14: a visible language switcher that persists the choice.
 * next-intl writes the SEADUEL_LOCALE cookie; once accounts exist, the same
 * handler will also persist users.locale.
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
