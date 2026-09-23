'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { autoPlaceFleet } from '@/game/autoplace';
import { createRng } from '@/game/rng';
import type { Coord } from '@/game/types';

import { Board } from './board';
import { coordLabel, opponentMarks, opponentOutlines, ownMarks, ownOutlines } from './board-model';
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

  const view = match.view;
  const phase = view?.phase ?? 'placement';
  // The server decides whose turn it is; this is only how it is displayed.
  const myTurn = view?.isYourTurn ?? false;

  const ownGrid = useMemo(() => (view ? ownMarks(view) : null), [view]);
  const opponentGrid = useMemo(() => (view ? opponentMarks(view) : null), [view]);

  const placementMarks = useMemo(() => {
    const grid: ReturnType<typeof ownMarks> = Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => 'water' as const),
    );
    for (const placement of draft.placements) {
      const horizontal = placement.orientation === 'horizontal';
      const size = { battleship: 4, cruiser: 3, destroyer: 2, submarine: 1 }[placement.shipClass];
      for (let offset = 0; offset < size; offset += 1) {
        const x = placement.origin.x + (horizontal ? offset : 0);
        const y = placement.origin.y + (horizontal ? 0 : offset);
        const row = grid[y];
        if (row) {
          row[x] = 'ship';
        }
      }
    }
    return grid;
  }, [draft.placements]);

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
    if (phase !== 'playing' || !myTurn) {
      return;
    }
    match.send({ type: 'fire', cells: [coord] });
  }

  const connecting = match.status === 'connecting' || match.status === 'waiting';

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{tm('live.title')}</h1>
        <p className="text-muted-foreground text-sm" role="status" aria-live="polite">
          {match.status === 'connected'
            ? tm('live.connected')
            : match.status === 'waiting'
              ? tm('live.waitingForOpponent')
              : match.status === 'reconnecting'
                ? tm('live.reconnecting')
                : match.status === 'failed'
                  ? tm('live.failed')
                  : tm('live.connecting')}
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
        <p className="border-destructive/40 bg-destructive/10 text-destructive mt-3 rounded-md border px-3 py-2 text-sm">
          {tm('live.rejected', { reason: match.lastError })}{' '}
          <button type="button" className="underline" onClick={match.clearError}>
            {tm('live.dismiss')}
          </button>
        </p>
      ) : null}

      {connecting && !view ? (
        <p className="text-muted-foreground mt-6 text-sm">{tm('live.waitingHint')}</p>
      ) : null}

      {view && phase === 'placement' && !submitted ? (
        <section className="mt-6 grid gap-6 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col gap-3">
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
                className="border-border rounded-md border px-3 py-1.5 text-sm"
              >
                {t('action.rotate')}
              </button>
              <button
                type="button"
                onClick={autoPlace}
                className="border-border rounded-md border px-3 py-1.5 text-sm"
              >
                {t('action.autoPlace')}
              </button>
              <button
                type="button"
                onClick={submitFleet}
                disabled={!draft.complete}
                className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {tm('live.confirmFleet')}
              </button>
            </div>
          </div>

          <Board
            title={t('board.yours')}
            gridLabel={t('board.yours')}
            marks={placementMarks}
            ghost={draft.ghost}
            invalidPulseKey={draft.invalidPulse}
            interaction={{
              cursor: draft.cursor,
              onCursorChange: actions.setCursor,
              onActivate: actions.activateCell,
              onPointerEnterCell: actions.setHover,
              onPointerLeaveBoard: () => actions.setHover(null),
              describeCell: (coord, mark) => t(`cell.${mark}`, { coord: coordLabel(coord) }),
            }}
          />
        </section>
      ) : null}

      {view && (phase !== 'placement' || submitted) && ownGrid && opponentGrid ? (
        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <Board
            title={t('board.yours')}
            gridLabel={t('board.yours')}
            marks={ownGrid}
            outlines={ownOutlines(view)}
          />
          <Board
            title={t('board.opponent')}
            gridLabel={t('board.opponent')}
            marks={opponentGrid}
            outlines={opponentOutlines(view)}
            active={myTurn && phase === 'playing'}
            {...(match.lastShot ? { lastShot: match.lastShot.coord } : {})}
            interaction={{
              cursor: { x: 0, y: 0 },
              onCursorChange: () => undefined,
              onActivate: fireAt,
              disabled: !myTurn || phase !== 'playing',
              describeCell: (coord, mark) => t(`cell.${mark}`, { coord: coordLabel(coord) }),
            }}
          />
        </section>
      ) : null}

      {view && phase === 'placement' && submitted ? (
        <p className="text-muted-foreground mt-6 text-sm">{tm('live.waitingForFleet')}</p>
      ) : null}
    </main>
  );
}
