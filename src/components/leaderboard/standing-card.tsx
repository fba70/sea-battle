import { getFormatter, getTranslations } from 'next-intl/server';

import { PlayerAvatar } from '@/components/player-avatar';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { gamesUntilRanked, winRate, type PlayerStanding } from '@/lib/leaderboard/leaderboard';
import {
  LEADERBOARD_INACTIVITY_DAYS,
  LEADERBOARD_MAX_RD,
  LEADERBOARD_MIN_RATED_GAMES,
} from '@/lib/rating/policy';

/**
 * "Around me" (spec §7.7).
 *
 * The acceptance criterion is explicit that a player excluded from the top ranking
 * must still be able to see where they stand, so this card has to work in five
 * states, not one: ranked, too few games, rating too uncertain, inactive, and not
 * rated at all — plus the guest case, who cannot hold a rating by construction.
 *
 * Every excluded state says what to do next, and the thresholds in the copy are the
 * policy constants rather than numbers typed into a translation, so the message
 * cannot drift from the rule.
 */

function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** How close the player is to the games gate — the one gate with a countable finish. */
async function QualificationProgress({ gamesRated }: { readonly gamesRated: number }) {
  const t = await getTranslations('leaderboard.standing');
  const remaining = gamesUntilRanked(gamesRated);
  const done = Math.min(gamesRated, LEADERBOARD_MIN_RATED_GAMES);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={LEADERBOARD_MIN_RATED_GAMES}
        aria-valuenow={done}
        aria-label={t('progressLabel')}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${(done / LEADERBOARD_MIN_RATED_GAMES) * 100}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {t('gamesProgress', { done, total: LEADERBOARD_MIN_RATED_GAMES, remaining })}
      </p>
    </div>
  );
}

export async function StandingCard({
  standing,
  isGuest,
  showProfileLink = true,
}: {
  /** Null when the viewer is signed out, a guest, or has never been rated. */
  readonly standing: PlayerStanding | null;
  readonly isGuest: boolean;
  readonly showProfileLink?: boolean;
}) {
  const t = await getTranslations('leaderboard.standing');
  const format = await getFormatter();

  // Guests are unrated by construction (Block 2 refuses them a ratings row), so the
  // honest thing to offer is an account, not a progress bar.
  if (isGuest || !standing) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card/50 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold tracking-tight">{t('unratedTitle')}</h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {isGuest ? t('guestBody') : t('signedOutBody')}
          </p>
        </div>
        <Button asChild variant="outline" className="shrink-0">
          <Link href="/play/quick">{t('playRated')}</Link>
        </Button>
      </section>
    );
  }

  const { eligibility } = standing;
  const rate = winRate(standing);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <PlayerAvatar
            name={standing.name}
            seed={standing.avatarSeed}
            className="size-11 text-sm"
          />
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate font-semibold tracking-tight">{t('title')}</h2>
            <p className="truncate text-sm text-muted-foreground">{standing.name}</p>
          </div>
        </div>

        {standing.rank === null ? (
          <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {t('unranked')}
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary tabular-nums">
            {t('rank', { rank: standing.rank })}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label={t('rating')} value={format.number(Math.round(standing.rating))} />
        <Figure label={t('deviation')} value={`±${format.number(Math.round(standing.rd))}`} />
        <Figure
          label={t('record')}
          value={`${format.number(standing.wins)} / ${format.number(standing.losses)}`}
        />
        <Figure
          label={t('winRate')}
          value={
            rate === null
              ? '—'
              : format.number(rate, { style: 'percent', maximumFractionDigits: 0 })
          }
        />
      </dl>

      {eligibility.eligible ? null : (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-sm text-pretty">
            {eligibility.reason === 'too_few_games' || eligibility.reason === 'never_rated'
              ? t('excluded.tooFewGames')
              : eligibility.reason === 'inactive'
                ? t('excluded.inactive', { days: LEADERBOARD_INACTIVITY_DAYS })
                : t('excluded.uncertain', {
                    rd: Math.round(standing.rd),
                    threshold: LEADERBOARD_MAX_RD,
                  })}
          </p>

          {eligibility.reason === 'too_few_games' || eligibility.reason === 'never_rated' ? (
            <QualificationProgress gamesRated={standing.gamesRated} />
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/play/quick">{t('playRated')}</Link>
            </Button>
            {showProfileLink ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/players/${standing.userId}`}>{t('viewProfile')}</Link>
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {eligibility.eligible && showProfileLink ? (
        <Link
          href={`/players/${standing.userId}`}
          className="rounded-sm text-sm text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t('viewProfile')}
        </Link>
      ) : null}
    </section>
  );
}
