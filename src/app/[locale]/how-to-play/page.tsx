import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  BufferDiagram,
  FleetDiagram,
  IllegalPlacementDiagram,
  LegalPlacementDiagram,
  OutcomesDiagram,
} from '@/components/rules-diagram';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'howToPlay' });

  return {
    title: t('title'),
    description: t('intro'),
    alternates: alternatesFor(locale as Locale, '/how-to-play'),
  };
}

function Step({
  number,
  title,
  children,
  aside,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:gap-8">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h2 className="flex items-baseline gap-3 text-lg font-semibold tracking-tight">
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary tabular-nums"
          >
            {number}
          </span>
          <span className="text-balance">{title}</span>
        </h2>
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-pretty text-muted-foreground">
          {children}
        </div>
      </div>

      {aside ? <div className="flex shrink-0 gap-3 sm:flex-col">{aside}</div> : null}
    </section>
  );
}

export default async function HowToPlayPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const t = await getTranslations('howToPlay');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-5 py-10">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t('title')}
          </h1>
          <p className="text-base leading-relaxed text-pretty text-muted-foreground">
            {t('intro')}
          </p>
        </div>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold tracking-[0.12em] uppercase">{t('goal.title')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
            {t('goal.body')}
          </p>
        </section>

        <Step
          number={1}
          title={t('place.title')}
          aside={<FleetDiagram label={t('place.fleetDiagram')} />}
        >
          <p>{t('place.board')}</p>
          <ul className="flex flex-col gap-1">
            {['four', 'three', 'two', 'one'].map((key) => (
              <li key={key} className="flex items-baseline gap-2">
                <span aria-hidden className="text-primary">
                  &bull;
                </span>
                {t(`place.fleet.${key}`)}
              </li>
            ))}
          </ul>
          <p>{t('place.orientation')}</p>
        </Step>

        <Step
          number={2}
          title={t('touching.title')}
          aside={
            <div className="grid w-full grid-cols-2 gap-3 sm:w-[13rem]">
              <figure className="flex flex-col gap-1.5">
                <LegalPlacementDiagram label={t('touching.legalDiagram')} />
                <figcaption className="text-xs font-medium text-primary">
                  {t('touching.allowed')}
                </figcaption>
              </figure>
              <figure className="flex flex-col gap-1.5">
                <IllegalPlacementDiagram label={t('touching.illegalDiagram')} />
                <figcaption className="text-xs font-medium text-destructive">
                  {t('touching.notAllowed')}
                </figcaption>
              </figure>
            </div>
          }
        >
          <p>{t('touching.body')}</p>
          <p>{t('touching.diagonals')}</p>
          <p>{t('touching.help')}</p>
        </Step>

        <Step
          number={3}
          title={t('fire.title')}
          aside={<OutcomesDiagram label={t('fire.outcomesDiagram')} />}
        >
          <p>{t('fire.turns')}</p>
          <p>
            <strong className="font-semibold text-foreground">{t('fire.againLead')}</strong>{' '}
            {t('fire.again')}
          </p>
          <p>{t('fire.noRepeat')}</p>
        </Step>

        <Step
          number={4}
          title={t('sink.title')}
          aside={<BufferDiagram label={t('sink.bufferDiagram')} />}
        >
          <p>{t('sink.body')}</p>
          <p>{t('sink.buffer')}</p>
          <p>{t('sink.win')}</p>
        </Step>

        <section className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 className="text-lg font-semibold tracking-tight">{t('bots.title')}</h2>
          <dl className="grid gap-3 sm:grid-cols-3">
            {['easy', 'medium', 'hard'].map((level) => (
              <div key={level} className="rounded-lg border border-border bg-card p-4">
                <dt className="text-sm font-semibold">{t(`bots.${level}.name`)}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {t(`bots.${level}.body`)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-5">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold tracking-tight">
            {t('salvo.title')}
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-normal text-muted-foreground">
              {t('salvo.badge')}
            </span>
          </h2>
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
            {t('salvo.body')}
          </p>
        </section>

        <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
          <Button size="lg" asChild>
            <Link href="/play/bot">{t('cta')}</Link>
          </Button>
          <Link
            href="/faq"
            className="rounded-sm text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('faqLink')}
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
