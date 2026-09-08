import { autoPlaceFleet } from '../autoplace';
import { FLEET_SHIP_COUNT } from '../constants';
import { fire } from '../fire';
import { createRng, type Rng } from '../rng';
import {
  createGame,
  isShipSunk,
  opponentOf,
  placeFleet,
  shipsRemaining,
  type GameState,
} from '../state';
import type { PlayerSlot, Ship } from '../types';
import { createPlayerView } from '../view';
import type { BotDifficulty, BotStrategy } from './types';

/** Hard cap so a broken strategy fails fast instead of hanging a test run. */
const MAX_SHOTS_PER_GAME = 1000;

function fleetPlacements(ships: readonly Ship[]) {
  return ships.map(({ shipClass, origin, orientation }) => ({ shipClass, origin, orientation }));
}

function startGame(fleetA: readonly Ship[], fleetB: readonly Ship[], firstTurn: PlayerSlot) {
  const placedA = placeFleet(createGame({ firstTurn }), 'a', fleetPlacements(fleetA));
  if (!placedA.ok) {
    throw new Error(`bot produced an illegal fleet: ${placedA.error.code}`);
  }
  const placedB = placeFleet(placedA.value, 'b', fleetPlacements(fleetB));
  if (!placedB.ok) {
    throw new Error(`bot produced an illegal fleet: ${placedB.error.code}`);
  }
  return placedB.value;
}

export interface SoloResult {
  /** Shots taken to sink all 10 ships. Lower is better. */
  readonly shots: number;
  /** Shots that struck a ship; always 20 for a completed board. */
  readonly hits: number;
  /**
   * Shots fired while at least one ship longer than one cell was still afloat.
   *
   * The remainder is the single-cell submarine endgame, where every remaining ship
   * is one cell and no strategy can tell two unknown cells apart — it is a pure
   * random search. Splitting the two makes search quality measurable on its own
   * instead of being masked by that irreducible tail.
   */
  readonly multiCellPhaseShots: number;
}

/**
 * Measures raw searching efficiency: how many shots a bot needs to clear one
 * board, with no opponent shooting back.
 *
 * This is the spec §7.3 acceptance metric ("average shots-to-win over a benchmark
 * of N simulated games"). Turn-passing is bypassed by handing the turn straight
 * back to the bot after every shot — a liberty taken by the *harness*, never by
 * the bot, which still only ever receives `createPlayerView(state, 'a')`.
 */
export function simulateSoloClear(
  bot: BotStrategy,
  boardSeed: number,
  botSeed: number,
): SoloResult {
  const defenderFleet = autoPlaceFleet(createRng(boardSeed));
  const attackerFleet = autoPlaceFleet(createRng(boardSeed + 1));

  let state = startGame(attackerFleet, defenderFleet, 'a');
  const rng = createRng(botSeed);
  let shots = 0;
  let hits = 0;
  let multiCellPhaseShots = 0;

  while (state.phase === 'playing' && shots < MAX_SHOTS_PER_GAME) {
    // Read from the authoritative state: this is the harness measuring, not the bot.
    const multiCellAfloat = state.boards.b.ships.some(
      (ship) => ship.size >= 2 && !isShipSunk(ship, state.boards.b.shots),
    );

    const coord = bot.chooseShot(createPlayerView(state, 'a'), rng);
    const result = fire(state, 'a', coord);

    if (!result.ok) {
      throw new Error(`${bot.difficulty} bot chose an illegal target: ${result.error.code}`);
    }

    shots += 1;
    if (multiCellAfloat) {
      multiCellPhaseShots += 1;
    }
    if (result.value.event.outcome !== 'miss') {
      hits += 1;
    }

    // Keep firing regardless of whose turn the rules would hand it to.
    state =
      result.value.state.phase === 'playing'
        ? { ...result.value.state, turn: 'a' }
        : result.value.state;
  }

  if (state.phase !== 'finished') {
    throw new Error(`${bot.difficulty} bot failed to clear the board in ${shots} shots`);
  }

  return { shots, hits, multiCellPhaseShots };
}

export interface SoloBenchmark {
  readonly difficulty: BotDifficulty;
  readonly games: number;
  readonly meanShots: number;
  readonly medianShots: number;
  readonly bestShots: number;
  readonly worstShots: number;
  /** Mean shots spent before the single-cell submarine endgame begins. */
  readonly meanMultiCellPhaseShots: number;
}

export function benchmarkSolo(bot: BotStrategy, games: number, seed = 0): SoloBenchmark {
  const shotCounts: number[] = [];
  let multiCellTotal = 0;

  for (let game = 0; game < games; game += 1) {
    const result = simulateSoloClear(bot, seed + game * 2, seed + game * 7 + 1);
    shotCounts.push(result.shots);
    multiCellTotal += result.multiCellPhaseShots;
  }

  const sorted = [...shotCounts].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)] ?? 0;

  return {
    difficulty: bot.difficulty,
    games,
    meanShots: shotCounts.reduce((total, value) => total + value, 0) / shotCounts.length,
    medianShots: middle,
    bestShots: sorted[0] ?? 0,
    worstShots: sorted.at(-1) ?? 0,
    meanMultiCellPhaseShots: multiCellTotal / games,
  };
}

export interface MatchResult {
  readonly winner: PlayerSlot;
  readonly shots: Readonly<Record<PlayerSlot, number>>;
  readonly moveCount: number;
}

/**
 * A full rules-accurate game between two bots, including Classic turn passing.
 * `firstTurn` alternates across a series so neither side keeps the opening move.
 */
export function playMatch(
  botA: BotStrategy,
  botB: BotStrategy,
  seed: number,
  firstTurn: PlayerSlot = 'a',
): MatchResult {
  const fleetRng = createRng(seed);
  const state0 = startGame(botA.chooseFleet(fleetRng), botB.chooseFleet(fleetRng), firstTurn);

  const rngs: Record<PlayerSlot, Rng> = { a: createRng(seed + 101), b: createRng(seed + 202) };
  const bots: Record<PlayerSlot, BotStrategy> = { a: botA, b: botB };
  const shots: Record<PlayerSlot, number> = { a: 0, b: 0 };

  let state = state0;
  let guard = 0;

  while (state.phase === 'playing' && guard < MAX_SHOTS_PER_GAME) {
    const slot = state.turn;
    if (!slot) {
      break;
    }

    const coord = bots[slot].chooseShot(createPlayerView(state, slot), rngs[slot]);
    const result = fire(state, slot, coord);

    if (!result.ok) {
      throw new Error(`${bots[slot].difficulty} bot chose an illegal target: ${result.error.code}`);
    }

    shots[slot] += 1;
    state = result.value.state;
    guard += 1;
  }

  if (!state.winner) {
    throw new Error(`match did not finish within ${MAX_SHOTS_PER_GAME} shots`);
  }

  return { winner: state.winner, shots, moveCount: state.moveCount };
}

export interface HeadToHeadResult {
  readonly games: number;
  readonly winsA: number;
  readonly winsB: number;
  readonly winRateA: number;
}

/** Plays a series, alternating who opens, and reports how often bot A wins. */
export function headToHead(
  botA: BotStrategy,
  botB: BotStrategy,
  games: number,
  seed = 0,
): HeadToHeadResult {
  let winsA = 0;

  for (let game = 0; game < games; game += 1) {
    const result = playMatch(botA, botB, seed + game * 13, game % 2 === 0 ? 'a' : 'b');
    if (result.winner === 'a') {
      winsA += 1;
    }
  }

  return { games, winsA, winsB: games - winsA, winRateA: winsA / games };
}

export function assertBoardCleared(state: GameState, slot: PlayerSlot): void {
  if (shipsRemaining(state.boards[opponentOf(slot)]) !== 0) {
    throw new Error(`expected all ${FLEET_SHIP_COUNT} ships sunk`);
  }
}
