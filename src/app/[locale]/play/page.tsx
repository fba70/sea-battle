import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'multiplayer' });
  return { title: t('hub.title'), alternates: alternatesFor(locale as Locale, '/play') };
}

/** The three ways into a game (spec §7.4). */
export default async function PlayHubPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('multiplayer');

  const options = [
    { href: '/play/bot', title: t('hub.bot'), hint: t('hub.botHint') },
    { href: '/play/quick', title: t('hub.quick'), hint: t('hub.quickHint') },
    { href: '/play/room', title: t('hub.room'), hint: t('hub.roomHint') },
  ] as const;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('hub.title')}</h1>
      <p className="text-muted-foreground mt-1 text-sm">{t('hub.subtitle')}</p>

      <ul className="mt-6 flex flex-col gap-3">
        {options.map((option) => (
          <li key={option.href}>
            <Link
              href={option.href}
              className="border-border hover:bg-accent focus-visible:ring-ring block rounded-lg border p-4 focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="font-medium">{option.title}</span>
              <span className="text-muted-foreground mt-1 block text-sm">{option.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
