import { Trophy } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { HeroGrid } from '@/components/hero-grid';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { LEADERBOARD_MAX_RD, LEADERBOARD_MIN_RATED_GAMES } from '@/lib/rating/policy';

/**
 * What the ladder looks like before anyone qualifies.
 *
 * Worth designing rather than leaving as an empty table: with rated play limited to
 * quick match between two registered accounts, this is genuinely the first thing most
 * visitors will see, and "nobody has qualified yet" plus the criteria reads as a
 * young ladder rather than a broken page.
 */
export async function EmptyBoard() {
  const t = await getTranslations('leaderboard.empty');

  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-card px-6 py-12 text-center">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden">
        <HeroGrid className="absolute -top-28 left-1/2 h-[24rem] w-[24rem] -translate-x-1/2 opacity-30" />
      </div>

      <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
        <span className="flex size-12 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
          <Trophy aria-hidden className="size-5" />
        </span>

        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-balance">{t('title')}</h2>
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
            {t('body', { games: LEADERBOARD_MIN_RATED_GAMES, rd: LEADERBOARD_MAX_RD })}
          </p>
        </div>

        <Button asChild>
          <Link href="/play/quick">{t('cta')}</Link>
        </Button>
      </div>
    </section>
  );
}
