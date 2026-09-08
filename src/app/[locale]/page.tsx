import { getTranslations, setRequestLocale } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { type Locale } from '@/i18n/routing';

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  const t = await getTranslations();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {t('app.name')}
        </span>
        <LocaleSwitcher />
      </header>

      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          {t('landing.title')}
        </h1>
        <p className="max-w-prose text-lg text-muted-foreground text-pretty">
          {t('landing.subtitle')}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled>
          {t('landing.playVsBot')}
        </Button>
        <Button size="lg" variant="outline" disabled>
          {t('landing.playVsFriend')}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{t('landing.foundationNotice')}</p>
    </main>
  );
}
