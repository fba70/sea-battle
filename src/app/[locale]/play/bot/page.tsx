import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BotMatchScreen } from '@/components/game/bot-match-screen';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'game' });

  return { title: t('title'), alternates: alternatesFor(locale as Locale, '/play/bot') };
}

export default async function PlayBotPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  return <BotMatchScreen />;
}
