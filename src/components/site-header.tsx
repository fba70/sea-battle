import { LocaleSwitcher } from '@/components/locale-switcher';
import { Link } from '@/i18n/navigation';
import { getTranslations } from 'next-intl/server';

/**
 * The shared chrome for every non-game page. Keeping one header means the rules
 * and FAQ are always one click away, which is the §7.9 acceptance criterion
 * ("FAQ and rules are reachable from the landing page").
 */
export async function SiteHeader() {
  const t = await getTranslations();

  return (
    <header className="border-b border-border/60">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4">
        <Link
          href="/"
          className="rounded-sm text-sm font-semibold tracking-[0.18em] uppercase focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t('app.name')}
        </Link>

        <nav aria-label={t('nav.label')} className="flex items-center gap-4 text-sm">
          <Link
            href="/how-to-play"
            className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('nav.howToPlay')}
          </Link>
          <Link
            href="/faq"
            className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t('nav.faq')}
          </Link>
        </nav>

        <div className="ms-auto">
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}
