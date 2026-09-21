import { Link } from '@/i18n/navigation';
import { getTranslations } from 'next-intl/server';

export async function SiteFooter() {
  const t = await getTranslations();

  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="text-pretty">{t('app.tagline')}</p>

        <nav aria-label={t('nav.footerLabel')} className="flex items-center gap-4">
          <Link
            href="/how-to-play"
            className="rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('nav.howToPlay')}
          </Link>
          <Link
            href="/faq"
            className="rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('nav.faq')}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
