import type { Metadata } from 'next';
import { ArrowRight, Users, Zap } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { HeroGrid } from '@/components/hero-grid';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { alternatesFor } from '@/lib/seo';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'multiplayer' });

  return {
    title: t('hub.title'),
    description: t('hub.subtitle'),
    alternates: alternatesFor(locale as Locale, '/play'),
  };
}

/**
 * One choice on the online hub.
 *
 * The whole card is the link, so the target is as large as the card on touch and the
 * focus ring surrounds the whole thing rather than a word inside it.
 */
function ModeCard({
  href,
  icon,
  title,
  description,
  action,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  action: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-4 rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary/60 hover:bg-accent/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-md border border-border bg-primary/10 text-primary transition-colors group-hover:border-primary/50"
      >
        {icon}
      </span>

      <span className="flex flex-col gap-1.5">
        <span className="text-lg font-semibold tracking-tight">{title}</span>
        <span className="text-sm leading-relaxed text-pretty text-muted-foreground">
          {description}
        </span>
      </span>

      <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-primary">
        {action}
        <ArrowRight
          aria-hidden
          className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}

/**
 * The online multiplayer hub (spec §7.4).
 *
 * Deliberately only the two live flows: the bot has its own entry point on the
 * landing page, and repeating it here would blur what this page is for.
 */
export default async function PlayOnlinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('multiplayer.hub');

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-10 sm:py-16">
        {/* Same placement as the landing page, so the motif reads as a backdrop
            rather than a cropped graphic. */}
        <HeroGrid className="absolute top-1/2 right-0 hidden h-[30rem] w-[30rem] -translate-y-1/2 translate-x-1/5 opacity-60 lg:block" />

        <div className="relative flex flex-col gap-8">
          <header className="flex max-w-2xl flex-col gap-3">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {t('title')}
            </h1>
            <p className="text-lg leading-relaxed text-pretty text-muted-foreground">
              {t('subtitle')}
            </p>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            <ModeCard
              href="/play/quick"
              icon={<Zap className="size-5" />}
              title={t('quick')}
              description={t('quickHint')}
              action={t('quickAction')}
            />
            <ModeCard
              href="/play/room"
              icon={<Users className="size-5" />}
              title={t('room')}
              description={t('roomHint')}
              action={t('roomAction')}
            />
          </div>

          <p className="max-w-2xl border-t border-border pt-5 text-sm text-muted-foreground">
            {t('note')}
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
