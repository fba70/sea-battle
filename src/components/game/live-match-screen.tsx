'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { autoPlaceFleet } from '@/game/autoplace';
import { cellsOfPlacement } from '@/game/placement';
import { createRng } from '@/game/rng';
import type { Coord } from '@/game/types';

import { GuestUpsell } from '@/components/account/guest-upsell';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { Board } from './board';
import {
  cellStateKey,
  coordLabel,
  opponentMarks,
  opponentOutlines,
  ownMarks,
  ownOutlines,
  type CellMark,
} from './board-model';
import { FleetTray } from './fleet-tray';
import { GameOverOverlay } from './game-over-overlay';
import { GraceCountdown, MatchClock } from './match-clock';
import { RatingChange } from './rating-change';
import { ResignButton } from './resign-button';
import { WaitingPanel } from './waiting-panel';
import { TurnBanner, type BannerState } from './status-panel';
import { useFleetPlacement } from './use-fleet-placement';
import { useLiveMatch } from './use-live-match';

/**
 * The live PvP screen (spec §7.4).
 *
 * A functional testing surface, not the finished product: it reuses the Phase 0 board,
 * fleet tray and placement interaction unchanged, and adds only what a live match
 * needs — a connection state, a server-driven view, and intents instead of local moves.
 * Polish, animation and the richer post-game flow belong with the UI pass.
 */
export function LiveMatchScreen({
  gameId,
  wsUrl,
  roomCode,
  onNewMatch,
}: {
  readonly gameId: string;
  readonly wsUrl: string;
  readonly roomCode?: string;
  /**
   * Starts another match without leaving the page.
   *
   * Quick match renders this screen *in place* at `/play/quick`, so a "New match"
   * link pointing at that same URL navigated nowhere and the finished game stayed on
   * screen — the button looked broken. The owner of the page resets itself instead.
   */
  readonly onNewMatch?: () => void;
}) {
  const t = useTranslations('game');
  const tm = useTranslations('multiplayer');
  const match = useLiveMatch(gameId, wsUrl);
  const [draft, actions] = useFleetPlacement();
  const [submitted, setSubmitted] = useState(false);
  const [autoPlaceCount, setAutoPlaceCount] = useState(0);
  const [targetCursor, setTargetCursor] = useState<Coord>({ x: 0, y: 0 });

  const view = match.view;
  const timers = match.timers;
  const phase = view?.phase ?? 'placement';
  // The server decides whose turn it is; this is only how it is displayed.
  const myTurn = view?.isYourTurn ?? false;
  const canFire = phase === 'playing' && myTurn;
  const won = phase === 'finished' && view?.winner === view?.viewer;

  const ownGrid = useMemo(() => (view ? ownMarks(view) : null), [view]);
  const opponentGrid = useMemo(() => (view ? opponentMarks(view) : null), [view]);

  /**
   * The draft fleet is drawn as ship outlines, exactly as the bot screen does it.
   * The board renders a `ship` mark as nothing at all — hulls come from `outlines` —
   * so passing the draft as marks would place ships that stayed invisible.
   */
  const draftOutlines = useMemo(
    () =>
      draft.placements.map((placement, index) => ({
        id: `draft-${index}`,
        cells: cellsOfPlacement(placement),
        sunk: false,
      })),
    [draft.placements],
  );

  /**
   * Caps the board so the whole square — labels included — fits the viewport.
   *
   * The board is `aspect-square`, so constraining its width constrains its height.
   * `100dvh` rather than `100vh` because mobile browser chrome collapses and expands;
   * the subtraction is the page header, the turn banner and the surrounding spacing.
   * Two boards sit side by side from `lg`, so only one board's height is ever in play.
   */
  const boardFrame = { maxWidth: 'min(30rem, calc(100dvh - 15rem))' } as const;

  const emptyMarks = useMemo<CellMark[][]>(
    () => Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 'water' as const)),
    [],
  );

  const describeOwnCell = (coord: Coord, mark: CellMark) =>
    t('cell.state', { cell: coordLabel(coord), state: t(`cell.${cellStateKey(mark)}`) });

  const describeTargetCell = (coord: Coord, mark: CellMark) =>
    t(canFire && mark === 'water' ? 'cell.fireAt' : 'cell.state', {
      cell: coordLabel(coord),
      state: t(`cell.${mark === 'water' ? 'unknown' : cellStateKey(mark)}`),
    });

  const banner: BannerState =
    phase === 'finished'
      ? won
        ? 'won'
        : 'lost'
      : phase === 'placement'
        ? 'placement'
        : myTurn
          ? 'yours'
          : 'opponent';

  function submitFleet(): void {
    if (!draft.complete) {
      return;
    }
    // A proposal (spec §5.3) — the server re-validates and may reject it.
    match.send({ type: 'place_fleet', placements: [...draft.placements] });
    match.send({ type: 'ready' });
    setSubmitted(true);
  }

  function autoPlace(): void {
    const next = autoPlaceCount + 1;
    setAutoPlaceCount(next);
    actions.applyFleet(
      autoPlaceFleet(createRng(Date.now() ^ next)).map(({ shipClass, origin, orientation }) => ({
        shipClass,
        origin,
        orientation,
      })),
    );
  }

  function resign(): void {
    match.send({ type: 'resign' });
  }

  function fireAt(coord: Coord): void {
    if (!canFire) {
      return;
    }
    match.send({ type: 'fire', cells: [coord] });
  }

  const seatOfViewer = view?.viewer ?? null;

  function renderStrikeWarning(missed: number, max: number) {
    if (missed === 0) {
      return null;
    }
    return (
      <p
        role="status"
        className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        {tm('live.missedTurns', { missed, max })}
      </p>
    );
  }

  const statusLabel =
    match.status === 'connected'
      ? tm('live.connected')
      : match.status === 'waiting'
        ? tm('live.waitingForOpponent')
        : match.status === 'reconnecting'
          ? tm('live.reconnecting')
          : match.status === 'failed'
            ? tm('live.failed')
            : tm('live.connecting');

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 lg:mb-3">
        <h1 className="text-xl font-semibold tracking-tight">{tm('live.title')}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* The clock sits beside the connection state: both answer "is this game
              still moving?", and a player glances at them together. */}
          {timers && phase !== 'finished' ? (
            <MatchClock
              deadlineTs={timers.deadlineTs}
              paused={timers.paused}
              label={phase === 'placement' ? tm('clock.placementLabel') : tm('clock.turnLabel')}
            />
          ) : null}
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {statusLabel}
          </p>
        </div>
      </header>

      <TurnBanner state={banner} compact />

      {/* Spec §9's `opponent_disconnected`: the player who is still here is told what
          is happening and when it resolves, rather than watching a frozen board. */}
      {timers?.opponentOffline &&
      timers.opponentGraceDeadlineTs !== null &&
      phase !== 'finished' ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 flex flex-wrap items-center gap-x-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
        >
          {tm.rich('live.opponentAway', {
            // A placeholder rather than a trailing value, so each language puts the
            // countdown where its own grammar wants it.
            time: () => <GraceCountdown deadlineTs={timers.opponentGraceDeadlineTs as number} />,
          })}
        </p>
      ) : null}

      {/* The third missed turn ends the game, so the warning arrives before it. */}
      {timers && seatOfViewer !== null && phase === 'playing'
        ? renderStrikeWarning(timers.missedTurns[seatOfViewer], timers.maxMissedTurns)
        : null}

      {match.lastError ? (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm('live.rejected', { reason: match.lastError })}{' '}
          <button type="button" className="underline" onClick={match.clearError}>
            {tm('live.dismiss')}
          </button>
        </p>
      ) : null}

      {!view ? (
        <div className="mt-6 lg:mt-5">
          <WaitingPanel
            tone={match.status === 'failed' ? 'problem' : 'waiting'}
            title={
              match.status === 'failed' ? tm('live.failedTitle') : tm('live.waitingForOpponent')
            }
            description={match.status === 'failed' ? tm('live.failed') : tm('live.waitingHint')}
            status={match.status === 'failed' ? undefined : statusLabel}
            {...(roomCode
              ? {
                  children: (
                    <p className="text-sm text-muted-foreground">
                      {tm('room.codeLabel')}{' '}
                      <span className="font-mono text-base font-semibold tracking-widest text-foreground">
                        {roomCode}
                      </span>
                    </p>
                  ),
                }
              : {})}
            actions={
              <Button asChild variant="outline" className="flex-1">
                <Link href="/play">{tm('live.result.lobby')}</Link>
              </Button>
            }
          />
        </div>
      ) : null}

      {view && phase === 'placement' && !submitted ? (
        /*
         * Stacked until `lg`, matching the bot screen. A two-column layout at `sm`
         * squeezed the board into whatever was left beside the fleet panel, and below
         * roughly 26rem the coordinate labels stop lining up comfortably with the
         * cells. The board keeps its size and the panel moves below it instead.
         */
        <section className="mt-5 grid gap-5 lg:mt-4 lg:grid-cols-[minmax(0,30rem)_minmax(0,18rem)] lg:items-start lg:justify-center">
          <div className="mx-auto w-full" style={boardFrame}>
            <Board
              title={t('board.yourFleet')}
              gridLabel={t('board.placementGrid')}
              marks={emptyMarks}
              outlines={draftOutlines}
              ghost={draft.ghost}
              invalidPulseKey={draft.invalidPulse}
              interaction={{
                cursor: draft.cursor,
                onCursorChange: actions.setCursor,
                onActivate: actions.activateCell,
                onPointerEnterCell: actions.setHover,
                onPointerLeaveBoard: () => actions.setHover(null),
                describeCell: describeOwnCell,
              }}
            />
          </div>

          {/*
            Drops the column to the first row of cells, so the Battleship card starts
            level with the grid rather than with the board's title. 2.75rem is the
            board's own leading above row 1: title (1rem) + section gap (0.5rem) +
            column-label row (1rem) + grid gap (0.25rem). Two-column layout only —
            stacked below `lg`, where there is nothing to align to.
          */}
          <div className="flex flex-col gap-3 lg:mt-11">
            <FleetTray
              remaining={draft.remaining}
              selected={draft.selected}
              onSelect={actions.selectShip}
              onBeginDrag={actions.beginDrag}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={actions.rotate}
                className="rounded-md border border-border px-3 py-1.5 text-sm"
              >
                {t('placement.rotate')}
              </button>
              <button
                type="button"
                onClick={autoPlace}
                className="rounded-md border border-border px-3 py-1.5 text-sm"
              >
                {t('placement.autoPlace')}
              </button>
              <button
                type="button"
                onClick={actions.reset}
                className="rounded-md border border-border px-3 py-1.5 text-sm"
              >
                {t('placement.reset')}
              </button>
            </div>
            <button
              type="button"
              onClick={submitFleet}
              disabled={!draft.complete}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {draft.complete ? t('placement.start') : t('placement.incomplete')}
            </button>
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              {t('placement.instructions')}
            </p>
          </div>
        </section>
      ) : null}

      {view && phase === 'placement' && submitted ? (
        <div className="mt-6 lg:mt-5">
          <WaitingPanel
            title={tm('live.fleetReadyTitle')}
            description={tm('live.waitingForFleet')}
            status={statusLabel}
          />
        </div>
      ) : null}

      {view && phase !== 'placement' && ownGrid && opponentGrid ? (
        <section className="relative mt-5 grid gap-5 lg:mt-4 lg:grid-cols-[minmax(0,30rem)_minmax(0,30rem)] lg:items-start lg:justify-center">
          <div className="mx-auto w-full" style={boardFrame}>
            <Board
              title={t('board.enemyWaters')}
              gridLabel={t('board.enemyGrid')}
              marks={opponentGrid}
              outlines={opponentOutlines(view)}
              active={canFire}
              {...(match.lastShot ? { lastShot: match.lastShot.coord } : {})}
              interaction={{
                cursor: targetCursor,
                onCursorChange: setTargetCursor,
                onActivate: fireAt,
                disabled: !canFire,
                describeCell: describeTargetCell,
              }}
            />
          </div>

          <div className="mx-auto w-full" style={boardFrame}>
            <Board
              title={t('board.yourFleet')}
              gridLabel={t('board.yourGrid')}
              marks={ownGrid}
              outlines={ownOutlines(view)}
            />
          </div>

          {phase === 'finished' ? (
            <GameOverOverlay
              won={won}
              title={
                view.winner === null
                  ? tm('live.result.abandonedTitle')
                  : won
                    ? t('result.wonTitle')
                    : t('result.lostTitle')
              }
              body={
                // Why it ended matters as much as who won: "they ran out of time" and
                // "they resigned" are different stories about the same scoreline.
                view.winner === null
                  ? tm('live.result.abandonedBody')
                  : tm(
                      `live.result.ended.${view.resultReason ?? 'sunk_all'}.${won ? 'won' : 'lost'}`,
                    )
              }
              stats={{
                shots: view.opponent.shotsFired,
                hits: view.opponent.hits,
                accuracy:
                  view.opponent.shotsFired === 0
                    ? 0
                    : view.opponent.hits / view.opponent.shotsFired,
                shipsLeft: view.own.shipsRemaining,
              }}
              footer={
                <div className="flex flex-col items-center gap-2">
                  {/* Spec §7.6's rating change, which arrives a moment after the
                      result and fills itself in. */}
                  <RatingChange outcome={match.rating} />
                  {/* Spec §7.5's prompt to save your progress. Renders nothing for
                      anyone who already has an account. */}
                  <GuestUpsell />
                </div>
              }
              actions={[
                onNewMatch
                  ? { label: tm('live.result.again'), onClick: onNewMatch }
                  : {
                      label: tm('live.result.again'),
                      href: roomCode ? '/play/room' : '/play/quick',
                    },
                { label: tm('live.result.lobby'), href: '/play', variant: 'outline' },
              ]}
            />
          ) : null}
        </section>
      ) : null}

      {/* Leaving is always available while a game is live, and always confirmed. */}
      {view && phase !== 'finished' ? (
        <div className="mt-5 flex justify-center border-t border-border pt-4">
          <ResignButton onResign={resign} />
        </div>
      ) : null}
    </main>
  );
}
