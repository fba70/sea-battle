import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';

import { MatchHistory } from '@/components/leaderboard/match-history';
import { PlayerAvatar } from '@/components/player-avatar';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { gamesUntilRanked, winRate } from '@/lib/leaderboard/leaderboard';
import { createLeaderboardStore } from '@/lib/leaderboard/leaderboard-store';
import {
  LEADERBOARD_INACTIVITY_DAYS,
  LEADERBOARD_MAX_RD,
  LEADERBOARD_MIN_RATED_GAMES,
} from '@/lib/rating/policy';
import { currentPlayer } from '@/lib/server-session';

type ProfileParams = { locale: string; id: string };

const HISTORY_LIMIT = 20;

export async function generateMetadata({
  params,
}: {
  params: Promise<ProfileParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'profile' });

  return {
    title: t('title'),
    description: t('subtitle'),
    // A profile is a per-player page with no translated twin worth advertising, and
    // search engines have no business indexing them, so no alternates and no index.
    robots: { index: false, follow: true },
  };
}

function Stat({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3">
      <span className="text-xs tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/**
 * A player's profile (spec §7.5, §7.7).
 *
 * What is public and what is not follows the spec rather than convenience: §7.7
 * already publishes name, rating and W/L on the leaderboard, so those are shown to
 * anyone. §2 says "Game history is private to the player in v1", so the match list is
 * loaded only when the viewer is the owner — not hidden in the UI, not loaded at all.
 */
export default async function PlayerProfilePage({ params }: { params: Promise<ProfileParams> }) {
  const { locale, id } = await params;
  setRequestLocale(locale as Locale);

  const t = await getTranslations('profile');
  const format = await getFormatter();

  const standing = await createLeaderboardStore().standing({
    userId: id,
    mode: 'classic',
    now: new Date(),
  });

  // No rating row means no public profile: guests never get one, and a registered
  // player gets theirs on their first rated game.
  if (!standing) {
    notFound();
  }

  const viewer = await currentPlayer();
  const isOwner = viewer?.id === id;

  const history = isOwner
    ? await createLeaderboardStore().history({ userId: id, limit: HISTORY_LIMIT })
    : [];

  const rate = winRate(standing);
  const { eligibility } = standing;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-7 px-5 py-8 sm:py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <PlayerAvatar
              name={standing.name}
              seed={standing.avatarSeed}
              className="size-14 text-base"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                {standing.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {standing.country ? <span className="uppercase">{standing.country}</span> : null}
                {standing.rank === null ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                    {eligibility.eligible
                      ? t('status.unranked')
                      : t(`status.${eligibility.reason}`)}
                  </span>
                ) : (
                  <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
                    {t('status.rank', { rank: standing.rank })}
                  </span>
                )}
              </div>
            </div>
          </div>

          <Button asChild variant="outline" className="shrink-0">
            <Link href="/leaderboard">{t('backToBoard')}</Link>
          </Button>
        </header>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label={t('stat.rating')}
            value={format.number(Math.round(standing.rating))}
            hint={t('stat.ratingHint')}
          />
          <Stat
            label={t('stat.deviation')}
            value={`±${format.number(Math.round(standing.rd))}`}
            hint={
              // Owner-only. Showing the pre-inflation RD next to the current one
              // lets anyone solve t = (rd² - stored²) / c² and recover the exact
              // moment of the last rated match — which the API deliberately
              // withholds from everyone but the owner.
              isOwner && Math.round(standing.rd) !== Math.round(standing.storedRd)
                ? t('stat.deviationInflated', { stored: Math.round(standing.storedRd) })
                : t('stat.deviationHint')
            }
          />
          <Stat
            label={t('stat.record')}
            value={`${format.number(standing.wins)} / ${format.number(standing.losses)}`}
            hint={t('stat.recordHint')}
          />
          <Stat
            label={t('stat.winRate')}
            value={
              rate === null
                ? '—'
                : format.number(rate, { style: 'percent', maximumFractionDigits: 0 })
            }
            hint={t('stat.gamesRated', { count: standing.gamesRated })}
          />
        </section>

        {eligibility.eligible ? null : (
          <section className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-card/50 px-5 py-4">
            <h2 className="text-sm font-semibold tracking-tight">{t('notRanked.title')}</h2>
            <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
              {eligibility.reason === 'too_few_games' || eligibility.reason === 'never_rated'
                ? t('notRanked.tooFewGames', {
                    remaining: gamesUntilRanked(standing.gamesRated),
                    total: LEADERBOARD_MIN_RATED_GAMES,
                  })
                : eligibility.reason === 'inactive'
                  ? t('notRanked.inactive', { days: LEADERBOARD_INACTIVITY_DAYS })
                  : t('notRanked.uncertain', { threshold: LEADERBOARD_MAX_RD })}
            </p>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">{t('history.title')}</h2>
            {isOwner ? (
              <span className="text-xs text-muted-foreground">{t('history.privateNote')}</span>
            ) : null}
          </div>

          {isOwner ? (
            <MatchHistory entries={history} />
          ) : (
            <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
              {t('history.private')}
            </p>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
