import { getTranslations, setRequestLocale } from 'next-intl/server';

import { HeroGrid } from '@/components/hero-grid';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { type Locale } from '@/i18n/routing';

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const t = await getTranslations();

  const facts = [
    { key: 'board', value: t('landing.facts.board') },
    { key: 'rules', value: t('landing.facts.rules') },
    { key: 'bots', value: t('landing.facts.bots') },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-10 sm:py-16">
        <HeroGrid className="absolute top-1/2 right-0 hidden h-[34rem] w-[34rem] -translate-y-1/2 translate-x-1/5 opacity-70 lg:block" />

        <div className="relative flex max-w-2xl flex-col gap-6">
          <h1 className="text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
            {t('landing.title')}
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
            {t('landing.subtitle')}
          </p>

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="lg" asChild>
              <Link href="/play/bot">{t('landing.playVsBot')}</Link>
            </Button>

            <div className="flex items-center gap-2">
              <Button size="lg" variant="outline" disabled>
                {t('landing.playVsFriend')}
              </Button>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                {t('landing.comingSoon')}
              </span>
            </div>
          </div>

          <Link
            href="/how-to-play"
            className="w-fit rounded-sm text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('nav.howToPlay')}
          </Link>

          <ul className="mt-2 flex flex-col gap-2 border-t border-border pt-5 text-sm text-muted-foreground sm:flex-row sm:gap-6">
            {facts.map((fact) => (
              <li key={fact.key} className="flex items-baseline gap-2">
                <span aria-hidden className="text-primary">
                  &bull;
                </span>
                {fact.value}
              </li>
            ))}
          </ul>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
