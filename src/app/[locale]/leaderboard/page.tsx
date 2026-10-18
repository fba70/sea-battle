import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { EmptyBoard } from '@/components/leaderboard/empty-board';
import { LeaderboardTable } from '@/components/leaderboard/leaderboard-table';
import { StandingCard } from '@/components/leaderboard/standing-card';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import type { Locale } from '@/i18n/routing';
import { LEADERBOARD_TOP_N, loadBoard } from '@/lib/leaderboard/cached';
import { createLeaderboardStore } from '@/lib/leaderboard/leaderboard-store';
import {
  LEADERBOARD_INACTIVITY_DAYS,
  LEADERBOARD_MAX_RD,
  LEADERBOARD_MIN_RATED_GAMES,
} from '@/lib/rating/policy';
import { alternatesFor } from '@/lib/seo';
import { currentPlayer } from '@/lib/server-session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'leaderboard' });

  return {
    title: t('title'),
    description: t('subtitle'),
    alternates: alternatesFor(locale as Locale, '/leaderboard'),
  };
}

/**
 * The global Classic ranking (spec §7.7).
 *
 * Dynamic rather than static, because the "around me" card depends on who is asking.
 * The ranked table itself is read through `loadBoard`, which caches it for a fixed
 * freshness window, so the shared part of the page is not recomputed per visitor.
 *
 * Only Classic is ranked today: ratings are keyed `(user_id, mode)`, and Salvo is a
 * Phase 2 mode with no games to rank (spec OQ-1 is settled by that key).
 */
export default async function LeaderboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('leaderboard');

  const player = await currentPlayer();
  const board = await loadBoard('classic', LEADERBOARD_TOP_N);

  // A guest can never hold a rating (Block 2), so their standing is not looked up.
  const standing =
    player && !player.isAnonymous
      ? await createLeaderboardStore().standing({
          userId: player.id,
          mode: 'classic',
          now: new Date(),
        })
      : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-5 py-8 sm:py-10">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t('title')}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground">
            {t('subtitle')}
          </p>
        </header>

        {/* A signed-out first visit has no session yet, which is not the same as
            playing as a guest — the two get different copy. */}
        <StandingCard standing={standing} isGuest={player?.isAnonymous === true} />

        {board.entries.length === 0 ? (
          <EmptyBoard />
        ) : (
          <>
            <LeaderboardTable entries={board.entries} highlightUserId={player?.id} />
            <p className="text-sm text-muted-foreground">
              {t('showing', { shown: board.entries.length, total: board.rankedCount })}
            </p>
          </>
        )}

        <section className="flex flex-col gap-2 border-t border-border pt-5">
          <h2 className="text-sm font-semibold tracking-tight">{t('criteria.title')}</h2>
          {/* The numbers come from the policy module, so this copy cannot drift from
              the rule the query applies. */}
          <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground">
            {t('criteria.body', {
              games: LEADERBOARD_MIN_RATED_GAMES,
              rd: LEADERBOARD_MAX_RD,
              days: LEADERBOARD_INACTIVITY_DAYS,
            })}
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
