'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { autoPlaceFleet } from '@/game/autoplace';
import { cellsOfPlacement } from '@/game/placement';
import { createRng } from '@/game/rng';
import type { Coord } from '@/game/types';

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
}: {
  readonly gameId: string;
  readonly wsUrl: string;
  readonly roomCode?: string;
}) {
  const t = useTranslations('game');
  const tm = useTranslations('multiplayer');
  const match = useLiveMatch(gameId, wsUrl);
  const [draft, actions] = useFleetPlacement();
  const [submitted, setSubmitted] = useState(false);
  const [autoPlaceCount, setAutoPlaceCount] = useState(0);
  const [targetCursor, setTargetCursor] = useState<Coord>({ x: 0, y: 0 });

  const view = match.view;
  const phase = view?.phase ?? 'placement';
  // The server decides whose turn it is; this is only how it is displayed.
  const myTurn = view?.isYourTurn ?? false;
  const canFire = phase === 'playing' && myTurn;

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
      ? view?.winner === view?.viewer
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

  function fireAt(coord: Coord): void {
    if (!canFire) {
      return;
    }
    match.send({ type: 'fire', cells: [coord] });
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
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{tm('live.title')}</h1>
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {statusLabel}
        </p>
      </header>

      {roomCode ? (
        <p className="mb-4 text-sm">
          {tm('room.codeLabel')}{' '}
          <span className="font-mono text-base font-semibold tracking-widest">{roomCode}</span>
        </p>
      ) : null}

      <TurnBanner state={banner} />

      {match.lastError ? (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm('live.rejected', { reason: match.lastError })}{' '}
          <button type="button" className="underline" onClick={match.clearError}>
            {tm('live.dismiss')}
          </button>
        </p>
      ) : null}

      {!view ? (
        <p className="mt-6 text-sm text-muted-foreground">{tm('live.waitingHint')}</p>
      ) : null}

      {view && phase === 'placement' && !submitted ? (
        <section className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="flex shrink-0 flex-col gap-3">
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

          <div className="w-full max-w-[30rem]">
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
        </section>
      ) : null}

      {view && phase === 'placement' && submitted ? (
        <p className="mt-6 text-sm text-muted-foreground">{tm('live.waitingForFleet')}</p>
      ) : null}

      {view && phase !== 'placement' && ownGrid && opponentGrid ? (
        <section className="mt-6 grid gap-6 lg:grid-cols-2">
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
          <Board
            title={t('board.yourFleet')}
            gridLabel={t('board.yourGrid')}
            marks={ownGrid}
            outlines={ownOutlines(view)}
          />
        </section>
      ) : null}
    </main>
  );
}
