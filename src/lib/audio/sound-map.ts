import type { GamePhase, ShotOutcome } from '@/game/types';
import type { SoundId } from './sprite.generated';

/**
 * Everything the audio layer needs to know about the match, flattened so the
 * mapping below can stay a pure function of two snapshots.
 *
 * Note what is absent: no board, no ships, no `GameState`. Audio is downstream of
 * the same filtered view the UI renders, so it cannot leak hidden information
 * through a sound cue either.
 */
export interface AudioSnapshot {
  readonly phase: GamePhase;
  readonly logLength: number;
  readonly lastShot?: { readonly outcome: ShotOutcome } | undefined;
  readonly awaitingBot: boolean;
  readonly humanWon: boolean;
  readonly humanLost: boolean;
  readonly placedCount: number;
  readonly invalidCount: number;
}

export interface ScheduledSound {
  readonly id: SoundId;
  readonly delayMs: number;
}

/** Gap between the launch sound and its impact, so a shot reads as one gesture. */
export const IMPACT_DELAY_MS = 150;
/** The turn cue lands after the impact has decayed. */
export const TURN_CUE_DELAY_MS = 280;
/** Victory/defeat comes last, clearly separated from the final impact. */
export const RESULT_DELAY_MS = 500;

const OUTCOME_SOUND: Record<ShotOutcome, SoundId> = {
  miss: 'miss',
  hit: 'hit',
  sunk: 'sink',
};

/**
 * Maps a state transition to the sounds it should trigger.
 *
 * Returning `[]` for the very first snapshot matters: nothing may play before the
 * player has interacted with the page (spec §7.2 autoplay policy), and a fresh
 * mount is not an interaction.
 */
export function soundsForTransition(
  previous: AudioSnapshot | null,
  next: AudioSnapshot,
): ScheduledSound[] {
  if (!previous) {
    return [];
  }

  const sounds: ScheduledSound[] = [];

  // --- placement phase ----------------------------------------------------
  if (next.invalidCount > previous.invalidCount) {
    sounds.push({ id: 'invalid', delayMs: 0 });
  }
  if (next.placedCount > previous.placedCount) {
    sounds.push({ id: 'place', delayMs: 0 });
  }

  // --- a shot resolved ----------------------------------------------------
  if (next.logLength > previous.logLength && next.lastShot) {
    sounds.push({ id: 'fire', delayMs: 0 });
    sounds.push({ id: OUTCOME_SOUND[next.lastShot.outcome], delayMs: IMPACT_DELAY_MS });
  }

  // --- end of game --------------------------------------------------------
  const justFinished = previous.phase !== 'finished' && next.phase === 'finished';
  if (justFinished) {
    if (next.humanWon) {
      sounds.push({ id: 'victory', delayMs: RESULT_DELAY_MS });
    } else if (next.humanLost) {
      sounds.push({ id: 'defeat', delayMs: RESULT_DELAY_MS });
    }
    // A finished game never also plays a turn cue.
    return sounds;
  }

  // --- turn handover ------------------------------------------------------
  const startedPlaying = previous.phase === 'placement' && next.phase === 'playing';
  const turnCameBack = previous.awaitingBot && !next.awaitingBot;

  if (next.phase === 'playing' && !next.awaitingBot && (startedPlaying || turnCameBack)) {
    sounds.push({ id: 'yourTurn', delayMs: startedPlaying ? 0 : TURN_CUE_DELAY_MS });
  }

  return sounds;
}
