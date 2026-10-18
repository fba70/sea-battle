import { getFormatter, getTranslations } from 'next-intl/server';

import { PlayerAvatar } from '@/components/player-avatar';
import { Link } from '@/i18n/navigation';
import { winRate, type LeaderboardEntry } from '@/lib/leaderboard/leaderboard';

/**
 * The ranked table (spec §7.7).
 *
 * A real `<table>`, because that is what this is — a screen reader announces the
 * column a cell belongs to, which a grid of divs cannot do. Narrow screens drop the
 * analytical columns rather than scrolling sideways: rank, player and rating are what
 * a ladder is for, and the rest reappears from `sm`. The player's record moves under
 * their name on mobile so nothing is actually lost.
 */
export async function LeaderboardTable({
  entries,
  highlightUserId,
}: {
  readonly entries: readonly LeaderboardEntry[];
  /** The viewer's own row, lifted out of the list so they can find themselves. */
  readonly highlightUserId?: string | undefined;
}) {
  const t = await getTranslations('leaderboard');
  const format = await getFormatter();

  const percent = (value: number | null) =>
    value === null ? '—' : format.number(value, { style: 'percent', maximumFractionDigits: 0 });

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{t('tableCaption')}</caption>
        <thead>
          <tr className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
            <th scope="col" className="px-3 py-3 text-start font-medium sm:px-4">
              {t('column.rank')}
            </th>
            <th scope="col" className="px-1 py-3 text-start font-medium">
              {t('column.player')}
            </th>
            <th scope="col" className="px-3 py-3 text-end font-medium sm:px-4">
              {t('column.rating')}
            </th>
            <th scope="col" className="hidden px-4 py-3 text-end font-medium sm:table-cell">
              {t('column.record')}
            </th>
            <th scope="col" className="hidden px-4 py-3 text-end font-medium md:table-cell">
              {t('column.winRate')}
            </th>
            <th scope="col" className="hidden px-4 py-3 text-end font-medium lg:table-cell">
              {t('column.deviation')}
            </th>
          </tr>
        </thead>

        <tbody>
          {entries.map((entry) => {
            const isViewer = entry.userId === highlightUserId;

            return (
              <tr
                key={entry.userId}
                aria-current={isViewer ? 'true' : undefined}
                className={`border-b border-border/60 last:border-b-0 ${
                  isViewer ? 'bg-primary/10' : ''
                }`}
              >
                <td className="px-3 py-3 font-mono text-muted-foreground tabular-nums sm:px-4">
                  {format.number(entry.rank)}
                </td>

                <td className="px-1 py-3">
                  <Link
                    href={`/players/${entry.userId}`}
                    className="flex items-center gap-2.5 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <PlayerAvatar name={entry.name} seed={entry.avatarSeed} />
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{entry.name}</span>
                        {entry.country ? (
                          <span className="text-xs text-muted-foreground uppercase">
                            {entry.country}
                          </span>
                        ) : null}
                      </span>
                      {/* The columns hidden on mobile, folded under the name. */}
                      <span className="text-xs text-muted-foreground tabular-nums sm:hidden">
                        {t('recordShort', { wins: entry.wins, losses: entry.losses })}
                      </span>
                    </span>
                  </Link>
                </td>

                <td className="px-3 py-3 text-end font-semibold tabular-nums sm:px-4">
                  {format.number(Math.round(entry.rating))}
                </td>

                <td className="hidden px-4 py-3 text-end tabular-nums sm:table-cell">
                  {t('recordShort', { wins: entry.wins, losses: entry.losses })}
                </td>

                <td className="hidden px-4 py-3 text-end tabular-nums md:table-cell">
                  {percent(winRate(entry))}
                </td>

                <td className="hidden px-4 py-3 text-end text-muted-foreground tabular-nums lg:table-cell">
                  ±{format.number(Math.round(entry.rd))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
