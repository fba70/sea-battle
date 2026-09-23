import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { QuickMatch } from '@/components/game/quick-match';
import { GuestSessionProvider } from '@/components/guest-session-provider';
import type { Locale } from '@/i18n/routing';
import { gameWebSocketUrl } from '@/lib/public-env';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'multiplayer' });
  return { title: t('quick.title'), alternates: alternatesFor(locale as Locale, '/play/quick') };
}

export default async function QuickMatchPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  return (
    <>
      <GuestSessionProvider />
      <QuickMatch wsUrl={gameWebSocketUrl()} />
    </>
  );
}
