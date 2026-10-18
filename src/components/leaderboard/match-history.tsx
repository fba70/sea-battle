import { getFormatter, getTranslations } from 'next-intl/server';

import type { MatchHistoryEntry } from '@/lib/leaderboard/leaderboard';

/**
 * A player's own finished games (spec §7.5's "match history and per-game stats").
 *
 * Spec §2 keeps history private to the player in v1, so this is only ever rendered on
 * your own profile — the page decides that, and the data layer never loads another
 * player's games.
 *
 * Nothing here comes near the stored board state. A finished game's `boards_json`
 * holds both fleets; the read that feeds this component does not select it.
 */
export async function MatchHistory({
  entries,
}: {
  readonly entries: readonly MatchHistoryEntry[];
}) {
  const t = await getTranslations('profile.history');
  const format = await getFormatter();

  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
        {t('empty')}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => {
        const opponent =
          entry.type === 'bot'
            ? t(`bot.${entry.botLevel ?? 'medium'}`)
            : (entry.opponentName ?? t('unknownOpponent'));

        return (
          <li
            key={entry.gameId}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 sm:px-4"
          >
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${
                entry.won === null
                  ? 'border-border bg-muted text-muted-foreground'
                  : entry.won
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-destructive/40 bg-destructive/10 text-destructive'
              }`}
            >
              {entry.won === null ? '–' : entry.won ? t('win') : t('loss')}
            </span>

            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{t('versus', { opponent })}</span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span>{entry.rated ? t('rated') : t('unrated')}</span>
                <span aria-hidden>·</span>
                <span>{t(`reason.${entry.resultReason ?? 'sunk_all'}`)}</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{t('moves', { count: entry.moveCount })}</span>
              </span>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-0.5">
              {entry.ratingDelta === null ? null : (
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    entry.ratingDelta >= 0 ? 'text-primary' : 'text-destructive'
                  }`}
                >
                  {entry.ratingDelta >= 0 ? '+' : '−'}
                  {format.number(Math.abs(Math.round(entry.ratingDelta)))}
                </span>
              )}
              {entry.endedAt ? (
                <time
                  dateTime={entry.endedAt.toISOString()}
                  className="text-xs whitespace-nowrap text-muted-foreground"
                >
                  {format.dateTime(entry.endedAt, { dateStyle: 'medium' })}
                </time>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
