'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { autoPlaceFleet } from '@/game/autoplace';
import type { BotDifficulty } from '@/game/bot';
import { cellsOfPlacement } from '@/game/placement';
import { createRng } from '@/game/rng';
import type { Coord, ShipPlacement } from '@/game/types';
import type { CellMark } from './board-model';
import { coordLabel, opponentMarks, opponentOutlines, ownMarks, ownOutlines } from './board-model';
import { Board } from './board';
import { DifficultyPicker } from './difficulty-picker';
import { FleetTray } from './fleet-tray';
import { GameOverOverlay } from './game-over-overlay';
import { MoveLog, TurnBanner } from './status-panel';
import { useBotMatch } from './use-bot-match';
import { useFleetPlacement } from './use-fleet-placement';

function cellFromPointer(clientX: number, clientY: number): Coord | null {
  const element = document.elementFromPoint(clientX, clientY);
  const raw = element?.closest<HTMLElement>('[data-cell]')?.dataset.cell;
  if (!raw) return null;

  const [x, y] = raw.split(',').map(Number);
  return x === undefined || y === undefined ? null : { x, y };
}

export function BotMatchScreen() {
  const t = useTranslations('game');
  const [difficulty, setDifficultyState] = useState<BotDifficulty>('medium');
  const { snapshot, start, fireAt, restart, setDifficulty } = useBotMatch('medium');
  const [draft, placement] = useFleetPlacement();
  const [targetCursor, setTargetCursor] = useState<Coord>({ x: 0, y: 0 });

  // Pointer drag: works for mouse and touch alike, and resolves the cell under the
  // finger via the board's data-cell hit targets (spec §7.10 "drag must work by touch").
  useEffect(() => {
    if (!draft.dragging) return;

    const move = (event: PointerEvent) => {
      const coord = cellFromPointer(event.clientX, event.clientY);
      if (coord) placement.setHover(coord);
    };
    const finish = (event: PointerEvent) => {
      const coord = cellFromPointer(event.clientX, event.clientY);
      if (coord) placement.placeAt(coord);
      placement.setHover(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });

    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [draft.dragging, placement]);

  // Rotate with R anywhere during placement (spec §7.1 "rotate button or key").
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'r' || event.key === 'R') placement.rotate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placement]);

  const handleDifficulty = useCallback(
    (next: BotDifficulty) => {
      setDifficultyState(next);
      setDifficulty(next);
    },
    [setDifficulty],
  );

  const { view, phase, humanWon, humanLost, awaitingBot } = snapshot;
  const placing = phase === 'placement';
  const finished = phase === 'finished';

  const bannerState = placing
    ? 'placement'
    : humanWon
      ? 'won'
      : humanLost
        ? 'lost'
        : awaitingBot
          ? 'opponent'
          : 'yours';

  const lastHumanShot = [...snapshot.log].reverse().find((entry) => entry.actor === 'human');
  const lastBotShot = [...snapshot.log].reverse().find((entry) => entry.actor === 'bot');

  const describeTargetCell = (coord: Coord, mark: CellMark) => {
    const canFire = !placing && !finished && !awaitingBot && mark === 'water';
    return t(canFire ? 'cell.fireAt' : 'cell.state', {
      cell: coordLabel(coord),
      state: t(`cell.${mark === 'water' ? 'unknown' : toKey(mark)}`),
    });
  };

  const describeOwnCell = (coord: Coord, mark: CellMark) =>
    t('cell.state', { cell: coordLabel(coord), state: t(`cell.${toKey(mark)}`) });

  // Placement re-uses the "own" board: the draft fleet is drawn from the local
  // draft, not from the view, because it has not been submitted yet.
  const draftOutlines = draft.placements.map((placementItem, index) => ({
    id: `draft-${index}`,
    cells: cellsOfPlacement(placementItem),
    sunk: false,
  }));

  return (
    <div
      className={`mx-auto flex w-full flex-col gap-4 px-1 py-4 sm:px-4 sm:py-6 ${
        placing ? 'max-w-4xl' : 'max-w-6xl'
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
        <span className="text-sm text-muted-foreground">
          {t('difficulty.playingAgainst', { level: t(`difficulty.${snapshot.difficulty}`) })}
        </span>
      </header>

      <div className="sticky top-0 z-20 -mx-1 bg-background/90 px-1 py-1 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
        <TurnBanner state={bannerState} />
      </div>

      <div
        className={
          placing
            ? 'relative grid gap-4 lg:grid-cols-[minmax(0,30rem)_minmax(0,18rem)]'
            : 'relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_15rem]'
        }
      >
        {placing ? (
          <>
            <div className="w-full max-w-[30rem]">
              <Board
                title={t('board.yourFleet')}
                gridLabel={t('board.placementGrid')}
                marks={ownMarks(view)}
                outlines={draftOutlines}
                ghost={draft.ghost}
                invalidPulseKey={draft.invalidPulse}
                interaction={{
                  cursor: draft.cursor,
                  onCursorChange: placement.setCursor,
                  onActivate: placement.activateCell,
                  describeCell: describeOwnCell,
                  onPointerEnterCell: placement.setHover,
                  onPointerLeaveBoard: () => placement.setHover(null),
                }}
              />
              <p className="mt-2 text-xs text-muted-foreground">{t('placement.instructions')}</p>
            </div>

            <aside className="flex flex-col gap-4">
              <DifficultyPicker value={difficulty} onChange={handleDifficulty} />

              <FleetTray
                remaining={draft.remaining}
                selected={draft.selected}
                orientation={draft.orientation}
                onSelect={placement.selectShip}
                onBeginDrag={placement.beginDrag}
              />

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={placement.rotate}>
                  {t('placement.rotate')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => placement.applyFleet(randomLegalFleet())}
                >
                  {t('placement.autoPlace')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={placement.reset}
                  disabled={draft.placements.length === 0}
                >
                  {t('placement.reset')}
                </Button>
              </div>

              <Button
                type="button"
                disabled={!draft.complete}
                onClick={() => start(draft.placements)}
              >
                {draft.complete ? t('placement.start') : t('placement.incomplete')}
              </Button>
            </aside>
          </>
        ) : (
          <>
            <Board
              className="w-full max-w-[30rem]"
              title={t('board.enemyWaters')}
              gridLabel={t('board.enemyGrid')}
              marks={opponentMarks(view)}
              outlines={opponentOutlines(view)}
              lastShot={lastHumanShot?.coord ?? null}
              interaction={{
                cursor: targetCursor,
                onCursorChange: setTargetCursor,
                onActivate: (coord) => fireAt(coord),
                disabled: finished || awaitingBot,
                describeCell: describeTargetCell,
              }}
            />

            <Board
              className="w-full max-w-[30rem]"
              title={t('board.yourFleet')}
              gridLabel={t('board.yourGrid')}
              marks={ownMarks(view)}
              outlines={ownOutlines(view)}
              lastShot={lastBotShot?.coord ?? null}
            />

            <aside className="flex flex-col gap-4">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{t('stats.enemyShips')}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {view.opponent.shipsRemaining}
                  </dd>
                </div>
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{t('stats.yourShips')}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{view.own.shipsRemaining}</dd>
                </div>
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{t('stats.shotsFired')}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{view.opponent.shotsFired}</dd>
                </div>
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{t('stats.hits')}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{view.opponent.hits}</dd>
                </div>
              </dl>

              <MoveLog log={snapshot.log} />
              <p className="text-xs text-muted-foreground">{t('keyboardHint')}</p>
            </aside>
          </>
        )}

        {finished ? <GameOverOverlay won={humanWon} onRestart={restart} /> : null}
      </div>
    </div>
  );
}

function toKey(mark: CellMark): string {
  return mark === 'known-empty' ? 'knownEmpty' : mark;
}

/**
 * A convenience fleet for the "auto-place" control (spec §4: "auto-placement
 * guarantees it"). Generated client-side purely to save the player time — the
 * engine re-validates it on submit exactly as it would a hand-placed fleet, so
 * nothing here is trusted.
 */
function randomLegalFleet(): readonly ShipPlacement[] {
  const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
  return autoPlaceFleet(createRng(seed)).map(({ shipClass, origin, orientation }) => ({
    shipClass,
    origin,
    orientation,
  }));
}
