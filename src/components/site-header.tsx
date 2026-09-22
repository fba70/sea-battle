import { LocaleSwitcher } from '@/components/locale-switcher';
import { Link } from '@/i18n/navigation';
import { getTranslations } from 'next-intl/server';

/**
 * The shared chrome for every non-game page. Keeping one header means the rules
 * and FAQ are always one click away, which is the §7.9 acceptance criterion
 * ("FAQ and rules are reachable from the landing page").
 *
 * Layout is deliberately two-row on small screens rather than a wrapping flex
 * row. English nav labels total 17 characters; Spanish and Italian reach 33
 * ("Preguntas frecuentes", "Domande frequenti"), and a single wrapping row left
 * the locale selector stranded on a line of its own. §7.14 and §8 require the
 * layout to flex for text expansion rather than assume English widths.
 *
 * Grid placement is used instead of reordering the markup, so the DOM order —
 * and therefore the tab order — stays brand, navigation, locale selector.
 */
export async function SiteHeader() {
  const t = await getTranslations();

  return (
    <header className="border-b border-border/60">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-4 sm:flex sm:flex-row sm:gap-x-5 sm:gap-y-0">
        <Link
          href="/"
          className="col-start-1 row-start-1 w-fit rounded-sm text-sm font-semibold tracking-[0.18em] uppercase focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t('app.name')}
        </Link>

        <nav
          aria-label={t('nav.label')}
          className="col-span-2 col-start-1 row-start-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:col-span-1 sm:row-start-1"
        >
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

        <div className="col-start-2 row-start-1 justify-self-end sm:ms-auto">
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}
