import { setRequestLocale } from 'next-intl/server';

import { RoomMatch } from '@/components/game/room-match';
import { GuestSessionProvider } from '@/components/guest-session-provider';
import type { Locale } from '@/i18n/routing';
import { gameWebSocketUrl } from '@/lib/public-env';

/** Spec §7.4: `/play/room/<code>` is the shareable link. */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  setRequestLocale(locale as Locale);

  return (
    <>
      <GuestSessionProvider />
      <RoomMatch code={code} wsUrl={gameWebSocketUrl()} />
    </>
  );
}
