import { autoPlaceFleet } from '../autoplace';
import { createBot, type BotDifficulty } from '../bot';
import { fire, type FireError } from '../fire';
import { validateFleet, type PlacementError } from '../placement';
import { createRng } from '../rng';
import { err, ok, type Result } from '../result';
import { createGame, placeFleet, type GameState } from '../state';
import type { Coord, GamePhase, PlayerSlot, ShipClass, ShipPlacement, ShotOutcome } from '../types';
import { createPlayerView, type PlayerView } from '../view';

/** The human always takes seat A; the bot takes seat B. */
export const HUMAN: PlayerSlot = 'a';
export const BOT: PlayerSlot = 'b';

export interface MatchLogEntry {
  readonly seq: number;
  readonly actor: 'human' | 'bot';
  readonly coord: Coord;
  readonly outcome: ShotOutcome;
  readonly sunkShipClass?: ShipClass;
  readonly gameOver: boolean;
}

/**
 * A complete local bot match.
 *
 * `game` holds BOTH fleets and must never reach the render layer — components
 * receive `snapshotOf(match)` instead, which exposes only the human's
 * `PlayerView`. Everything here is pure: each transition returns a new match, and
 * the RNG for every decision is derived from `seed` plus the move number, so a
 * match replays identically from its seed.
 */
export interface BotMatch {
  readonly game: GameState;
  readonly difficulty: BotDifficulty;
  readonly seed: number;
  readonly log: readonly MatchLogEntry[];
}

/** What the UI is allowed to see. Contains no hidden opponent information. */
export interface BotMatchSnapshot {
  readonly view: PlayerView;
  readonly difficulty: BotDifficulty;
  readonly phase: GamePhase;
  readonly log: readonly MatchLogEntry[];
  /** True when the bot is the one to move. */
  readonly awaitingBot: boolean;
  readonly humanWon: boolean;
  readonly humanLost: boolean;
}

function rngFor(seed: number, step: number) {
  // Decorrelate consecutive steps so successive moves are not near-identical draws.
  return createRng((seed ^ Math.imul(step + 1, 2654435761)) >>> 0);
}

export function createBotMatch(options: {
  difficulty: BotDifficulty;
  seed: number;
  firstTurn?: PlayerSlot;
}): BotMatch {
  const { difficulty, seed, firstTurn = HUMAN } = options;
  const bot = createBot(difficulty);

  const botFleet = bot.chooseFleet(rngFor(seed, 0));
  const placed = placeFleet(
    createGame({ firstTurn }),
    BOT,
    botFleet.map(({ shipClass, origin, orientation }) => ({ shipClass, origin, orientation })),
  );

  if (!placed.ok) {
    throw new Error(`bot produced an illegal fleet: ${placed.error.code}`);
  }

  return { game: placed.value, difficulty, seed, log: [] };
}

export function humanView(match: BotMatch): PlayerView {
  return createPlayerView(match.game, HUMAN);
}

export function snapshotOf(match: BotMatch): BotMatchSnapshot {
  const view = humanView(match);

  return {
    view,
    difficulty: match.difficulty,
    phase: view.phase,
    log: match.log,
    awaitingBot: view.phase === 'playing' && view.turn === BOT,
    humanWon: view.phase === 'finished' && view.winner === HUMAN,
    humanLost: view.phase === 'finished' && view.winner === BOT,
  };
}

/** Installs the human fleet. The engine re-validates it exactly as a server would. */
export function placeHumanFleet(
  match: BotMatch,
  placements: readonly ShipPlacement[],
): Result<BotMatch, PlacementError> {
  const validated = validateFleet(placements);
  if (!validated.ok) {
    return err(validated.error);
  }

  const placed = placeFleet(match.game, HUMAN, placements);
  if (!placed.ok) {
    return err(placed.error as PlacementError);
  }

  return ok({ ...match, game: placed.value });
}

/** A legal random fleet for the human, for the "auto-place" control (spec §4). */
export function autoFleetFor(match: BotMatch, attempt: number): readonly ShipPlacement[] {
  return autoPlaceFleet(rngFor(match.seed, 1000 + attempt)).map(
    ({ shipClass, origin, orientation }) => ({ shipClass, origin, orientation }),
  );
}

function appendLog(
  match: BotMatch,
  actor: 'human' | 'bot',
  event: { coord: Coord; outcome: ShotOutcome; gameOver: boolean; sunk?: { shipClass: ShipClass } },
): readonly MatchLogEntry[] {
  return [
    ...match.log,
    {
      seq: match.log.length,
      actor,
      coord: event.coord,
      outcome: event.outcome,
      gameOver: event.gameOver,
      ...(event.sunk ? { sunkShipClass: event.sunk.shipClass } : {}),
    },
  ];
}

/** The human fires at the bot's board. */
export function humanFire(match: BotMatch, coord: Coord): Result<BotMatch, FireError> {
  const result = fire(match.game, HUMAN, coord);
  if (!result.ok) {
    return err(result.error);
  }

  return ok({
    ...match,
    game: result.value.state,
    log: appendLog(match, 'human', result.value.event),
  });
}

/**
 * Plays exactly one bot shot.
 *
 * The bot is handed `createPlayerView(game, BOT)` — the same filtered view a
 * remote opponent would get — so it cannot see the human's un-hit ships.
 */
export function botFire(match: BotMatch): Result<BotMatch, FireError> {
  if (match.game.phase !== 'playing' || match.game.turn !== BOT) {
    return err({ code: 'not_your_turn', message: 'It is not the bot turn' });
  }

  const bot = createBot(match.difficulty);
  const view = createPlayerView(match.game, BOT);
  const coord = bot.chooseShot(view, rngFor(match.seed, match.game.moveCount + 1));

  const result = fire(match.game, BOT, coord);
  if (!result.ok) {
    return err(result.error);
  }

  return ok({
    ...match,
    game: result.value.state,
    log: appendLog(match, 'bot', result.value.event),
  });
}

/** Restarts with the same difficulty and a fresh seed, keeping nothing else. */
export function restartMatch(match: BotMatch, seed: number): BotMatch {
  return createBotMatch({ difficulty: match.difficulty, seed });
}
