import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'account' });

  return { title: t('verifiedTitle'), robots: { index: false, follow: false } };
}

/**
 * Where a confirmation link lands (spec §7.5).
 *
 * better-auth has already done the work by the time anyone arrives: the token is
 * checked on its own endpoint, which then redirects here. A failure redirects
 * here too with `?error=`, so one page covers both and neither needs a token.
 */
export default async function VerifiedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('account');

  const failed = error !== undefined;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card px-6 py-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t(failed ? 'verifyFailedTitle' : 'verifiedTitle')}
          </h1>
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
            {t(failed ? 'verifyFailedLead' : 'verifiedLead')}
          </p>

          <Button asChild size="lg">
            <Link href={failed ? '/account' : '/play'}>{t(failed ? 'signIn' : 'continue')}</Link>
          </Button>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
