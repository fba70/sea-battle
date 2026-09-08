'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { BotDifficulty } from '@/game/bot';
import { thinkingDelayMs } from '@/game/bot';
import {
  botFire,
  createBotMatch,
  humanFire,
  placeHumanFleet,
  snapshotOf,
  type BotMatch,
  type BotMatchSnapshot,
} from '@/game/match/bot-match';
import { createRng } from '@/game/rng';
import type { Coord, ShipPlacement } from '@/game/types';

function freshSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

export interface BotMatchController {
  /**
   * Deliberately the ONLY game data the hook returns. The `BotMatch` itself holds
   * both fleets and never leaves this module, so no component can render — or even
   * read — the bot's hidden ships.
   */
  readonly snapshot: BotMatchSnapshot;
  start: (placements: readonly ShipPlacement[]) => boolean;
  fireAt: (coord: Coord) => boolean;
  restart: () => void;
  setDifficulty: (difficulty: BotDifficulty) => void;
}

/**
 * Owns the match and drives the bot's turns.
 *
 * The match object never leaves this hook — components are handed
 * `snapshot`, which contains only the human's `PlayerView`.
 */
export function useBotMatch(initialDifficulty: BotDifficulty): BotMatchController {
  /**
   * Seeded once, during the first render.
   *
   * Server and client necessarily draw different seeds, but that cannot cause a
   * hydration mismatch: the only thing a seed decides is the bot's fleet, and the
   * placement screen renders nothing derived from it. Hidden information stays
   * hidden from the server-rendered markup too.
   */
  const [match, setMatch] = useState<BotMatch>(() =>
    createBotMatch({ difficulty: initialDifficulty, seed: freshSeed() }),
  );
  const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (botTimer.current) clearTimeout(botTimer.current);
    },
    [],
  );

  const snapshot = useMemo(() => snapshotOf(match), [match]);

  // The bot plays on a timer so its shots feel human-paced (spec §7.3). Because a
  // hit earns another shot, this re-runs until the turn comes back or the game ends.
  useEffect(() => {
    if (!snapshot.awaitingBot) {
      return;
    }

    const delay = thinkingDelayMs(createRng(match.seed ^ match.game.moveCount));
    botTimer.current = setTimeout(() => {
      setMatch((current) => {
        if (current.game.phase !== 'playing' || current.game.turn !== 'b') {
          return current;
        }
        const result = botFire(current);
        return result.ok ? result.value : current;
      });
    }, delay);

    return () => {
      if (botTimer.current) clearTimeout(botTimer.current);
    };
  }, [match, snapshot.awaitingBot]);

  const start = useCallback((placements: readonly ShipPlacement[]) => {
    let accepted = false;
    setMatch((current) => {
      if (!current) return current;
      const result = placeHumanFleet(current, placements);
      accepted = result.ok;
      return result.ok ? result.value : current;
    });
    return accepted;
  }, []);

  const fireAt = useCallback((coord: Coord) => {
    let accepted = false;
    setMatch((current) => {
      const result = humanFire(current, coord);
      accepted = result.ok;
      return result.ok ? result.value : current;
    });
    return accepted;
  }, []);

  const restart = useCallback(() => {
    setMatch((current) => createBotMatch({ difficulty: current.difficulty, seed: freshSeed() }));
  }, []);

  const setDifficulty = useCallback((difficulty: BotDifficulty) => {
    setMatch((current) =>
      current.game.phase === 'placement'
        ? createBotMatch({ difficulty, seed: freshSeed() })
        : current,
    );
  }, []);

  return { snapshot, start, fireAt, restart, setDifficulty };
}
