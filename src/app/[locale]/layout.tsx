import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SoundProvider } from '@/lib/audio/use-audio';
import { alternatesFor, SITE_URL } from '@/lib/seo';
import { routing, type Locale } from '@/i18n/routing';

import '../globals.css';

type LocaleParams = { locale: string };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Spec §7.10: "Handle `viewport-fit=cover` / safe areas (notches)".
 * Covering the full screen is what makes the safe-area insets meaningful; the
 * insets themselves are applied in globals.css and on the two sticky bars.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<LocaleParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'app' });

  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t('name'), template: `%s · ${t('name')}` },
    description: t('tagline'),
    // Only correct for the locale root. Every child page sets its own — metadata
    // is inherited, so without that /en/faq would claim canonical /en (§7.14).
    alternates: alternatesFor(locale as Locale, ''),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<LocaleParams>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Required for static rendering of this locale's routes.
  setRequestLocale(locale as Locale);

  return (
    <html
      lang={locale}
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          <SoundProvider>{children}</SoundProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
