import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { RoomLobby } from '@/components/game/room-lobby';
import { GuestSessionProvider } from '@/components/guest-session-provider';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'multiplayer' });
  return { title: t('room.title'), alternates: alternatesFor(locale as Locale, '/play/room') };
}

export default async function RoomLobbyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  return (
    <>
      {/* Entering a game is where a durable identity is needed (spec §7.5). */}
      <GuestSessionProvider />
      <RoomLobby />
    </>
  );
}
