import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuthPanel } from '@/components/account/auth-panel';
import { HeroGrid } from '@/components/hero-grid';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });

  return {
    title: t('title'),
    description: t('lead'),
    alternates: alternatesFor(locale as Locale, '/account'),
  };
}

/**
 * Sign in or create an account (spec §7.5).
 *
 * Static: the panel is a client component and the session lives in the browser, so
 * nothing here depends on who is asking.
 */
export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('account');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <HeroGrid className="pointer-events-none absolute top-0 left-1/2 hidden h-[24rem] w-[24rem] -translate-x-1/2 opacity-25 sm:block" />

        <div className="relative flex flex-col gap-6">
          <header className="flex flex-col gap-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('title')}</h1>
            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{t('lead')}</p>
          </header>

          <AuthPanel />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
