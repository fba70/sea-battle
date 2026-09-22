'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { autoPlaceFleet } from '@/game/autoplace';
import type { BotDifficulty } from '@/game/bot';
import { cellsOfPlacement } from '@/game/placement';
import { createRng } from '@/game/rng';
import type { Coord, ShipPlacement } from '@/game/types';
import type { CellMark } from './board-model';
import { FLEET_SHIP_COUNT } from '@/game/constants';
import { coordLabel, opponentMarks, opponentOutlines, ownMarks, ownOutlines } from './board-model';
import { Board } from './board';
import { DifficultyPicker } from './difficulty-picker';
import { FleetTray } from './fleet-tray';
import { GameOverOverlay } from './game-over-overlay';
import { soundsForTransition, type AudioSnapshot } from '@/lib/audio/sound-map';
import { useSound } from '@/lib/audio/use-audio';
import { SoundToggle } from './sound-toggle';
import { MoveLog, StatTiles, TurnBanner, type BannerState } from './status-panel';
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
  const audio = useSound();

  // Pointer drag: works for mouse and touch alike, and resolves the cell under the
  // finger via the board's data-cell hit targets (spec §7.10 "drag must work by touch").
  useEffect(() => {
    if (!draft.dragging) return;

    const move = (event: PointerEvent) => {
      const coord = cellFromPointer(event.clientX, event.clientY);
      if (coord) placement.setHover(coord);
    };
    const drop = (event: PointerEvent) => {
      const coord = cellFromPointer(event.clientX, event.clientY);
      if (coord) placement.placeAt(coord);
      placement.setHover(null);
    };

    /**
     * A cancelled gesture must abandon the drag, never commit it. iOS fires
     * pointercancel whenever the browser takes the gesture over — a scroll, a
     * system edge swipe, an incoming call — and treating that as a drop placed
     * ships the player never intended to place.
     */
    const abort = () => {
      placement.setHover(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop, { once: true });
    window.addEventListener('pointercancel', abort, { once: true });

    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', abort);
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

  // Sound is derived from the same snapshot the UI renders, through a pure
  // mapping — see src/lib/audio/sound-map.ts.
  const audioState = useMemo<AudioSnapshot>(() => {
    const last = snapshot.log.at(-1);
    return {
      phase: snapshot.phase,
      logLength: snapshot.log.length,
      lastShot: last ? { outcome: last.outcome } : undefined,
      awaitingBot: snapshot.awaitingBot,
      humanWon: snapshot.humanWon,
      humanLost: snapshot.humanLost,
      placedCount: draft.placements.length,
      invalidCount: draft.invalidPulse,
    };
  }, [snapshot, draft.placements.length, draft.invalidPulse]);

  const previousAudioState = useRef<AudioSnapshot | null>(null);

  useEffect(() => {
    const sounds = soundsForTransition(previousAudioState.current, audioState);
    previousAudioState.current = audioState;
    if (sounds.length > 0) {
      audio.playAll(sounds);
    }
  }, [audioState, audio]);

  const handleDifficulty = useCallback(
    (next: BotDifficulty) => {
      audio.play('click');
      setDifficultyState(next);
      setDifficulty(next);
    },
    [audio, setDifficulty],
  );

  const { view, phase, humanWon, humanLost, awaitingBot } = snapshot;
  const placing = phase === 'placement';
  const finished = phase === 'finished';

  const bannerState: BannerState = placing
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
  const lastShot = snapshot.log.at(-1);

  const describeShot = (entry: typeof lastShot) => {
    if (!entry) return undefined;
    const who = entry.actor === 'human' ? 'you' : 'bot';
    const outcome = entry.sunkShipClass ? 'Sunk' : entry.outcome === 'miss' ? 'Miss' : 'Hit';
    return t(`announce.${who}${outcome}`, {
      cell: coordLabel(entry.coord),
      ship: entry.sunkShipClass ? t(`ship.${entry.sunkShipClass}`) : '',
    });
  };

  const placedCount = draft.placements.length;

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
      <header className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
          {t('title')}
        </h1>
        <div className="flex items-center gap-2">
          <span className="w-fit rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
            {t('difficulty.playingAgainst', { level: t(`difficulty.${snapshot.difficulty}`) })}
          </span>
          <Link
            href="/how-to-play"
            className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            {t('help')}
          </Link>
          <SoundToggle />
        </div>
      </header>

      <div className="sticky top-[env(safe-area-inset-top,0px)] z-20 -mx-1 bg-background/90 px-1 py-1 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
        <TurnBanner
          state={bannerState}
          detail={
            placing
              ? t('placed', { placed: placedCount, total: FLEET_SHIP_COUNT })
              : describeShot(lastShot)
          }
        />
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
              <p className="mt-2.5 max-w-prose text-xs leading-relaxed text-muted-foreground">
                {t('placement.instructions')}
              </p>
            </div>

            <aside className="flex flex-col gap-4">
              <DifficultyPicker value={difficulty} onChange={handleDifficulty} />

              <FleetTray
                remaining={draft.remaining}
                selected={draft.selected}
                onSelect={placement.selectShip}
                onBeginDrag={placement.beginDrag}
              />

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    audio.play('click');
                    placement.rotate();
                  }}
                >
                  {t('placement.rotate')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    audio.play('click');
                    placement.applyFleet(randomLegalFleet());
                  }}
                >
                  {t('placement.autoPlace')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="col-span-2 text-muted-foreground"
                  onClick={() => {
                    audio.play('click');
                    placement.reset();
                  }}
                  disabled={placedCount === 0}
                >
                  {t('placement.reset')}
                </Button>
              </div>

              <Button
                type="button"
                size="lg"
                className="hidden lg:inline-flex"
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
              active={!finished && !awaitingBot}
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
              active={!finished && awaitingBot}
              title={t('board.yourFleet')}
              gridLabel={t('board.yourGrid')}
              marks={ownMarks(view)}
              outlines={ownOutlines(view)}
              lastShot={lastBotShot?.coord ?? null}
            />

            <aside className="flex flex-col gap-4">
              <StatTiles
                items={[
                  {
                    key: 'enemy',
                    label: t('stats.enemyShips'),
                    value: String(view.opponent.shipsRemaining),
                  },
                  {
                    key: 'yours',
                    label: t('stats.yourShips'),
                    value: String(view.own.shipsRemaining),
                  },
                  {
                    key: 'shots',
                    label: t('stats.shotsFired'),
                    value: String(view.opponent.shotsFired),
                  },
                  { key: 'hits', label: t('stats.hits'), value: String(view.opponent.hits) },
                ]}
              />

              <MoveLog log={snapshot.log} />
              <p className="text-xs text-muted-foreground">{t('keyboardHint')}</p>
            </aside>
          </>
        )}

        {finished ? (
          <GameOverOverlay
            won={humanWon}
            stats={{
              shots: view.opponent.shotsFired,
              hits: view.opponent.hits,
              accuracy:
                view.opponent.shotsFired === 0 ? 0 : view.opponent.hits / view.opponent.shotsFired,
              shipsLeft: view.own.shipsRemaining,
            }}
            onRestart={restart}
          />
        ) : null}
      </div>

      {/* Thumb-reachable primary action on small screens (spec §7.10). Lives outside
          the board grid so it never floats over the sidebar controls. */}
      {placing ? (
        <div
          className={[
            'z-20 -mx-1 border-t border-border bg-background/95 px-3 pt-2.5 backdrop-blur',
            'pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] sm:-mx-4 sm:px-4 lg:hidden',
            // Pin the bar only once the action is actually available. While the
            // fleet is incomplete the button is disabled, and pinning it would
            // float a dead control over the fleet tray — hiding the very
            // controls needed to finish placing (§7.10 acceptance: placement
            // must be completable on a 360px phone).
            draft.complete ? 'sticky bottom-0' : '',
          ].join(' ')}
        >
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={!draft.complete}
            onClick={() => start(draft.placements)}
          >
            {draft.complete ? t('placement.start') : t('placement.incomplete')}
          </Button>
        </div>
      ) : null}
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
