import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ResetPassword } from '@/components/account/reset-password';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import type { Locale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });

  // Never indexed: the page is only meaningful with a one-time token attached.
  return { title: t('resetTitle'), robots: { index: false, follow: false } };
}

/** Where an emailed reset link lands (spec §7.5). */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('account');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">{t('resetTitle')}</h1>
            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
              {t('resetLead')}
            </p>
          </header>

          <section className="rounded-xl border border-border bg-card px-6 py-8">
            {/* The token is read from the query string, which needs a boundary. */}
            <Suspense fallback={null}>
              <ResetPassword />
            </Suspense>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
