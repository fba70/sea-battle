/**
 * The game-result report: how the Durable Object tells the Next app a match is over
 * (spec §5.1, "on game end, writes the completed game + result to Neon and triggers
 * rating update").
 *
 * The realtime layer deliberately has no database credentials — it reports the outcome
 * and the Next app, which owns Neon, does the writing. The report is signed with the
 * shared secret and scoped to its own purpose, so a connection ticket can never be
 * presented as a result and vice versa.
 *
 * Note what the report does *not* carry: no winner, no move count, no result reason.
 * Those are all derivable from the encoded final state, and deriving them means the
 * receiving side re-checks them through the Block 1 codec instead of trusting a set of
 * scalars that could disagree with the board.
 */
import type { EncodedGameState } from '@/game/codec';

import { signMessage, verifyMessage } from './hmac';

export const RESULT_PURPOSE = 'seaduel.game-result.v1';

/** The header the signature travels in. */
export const RESULT_SIGNATURE_HEADER = 'x-seaduel-signature';

export interface GameResultReport {
  readonly gameId: string;
  /** The authoritative final state, encoded by the Block 1 codec. */
  readonly state: EncodedGameState;
}

/** Serialises and signs a report. The body is signed verbatim, bytes as sent. */
export async function signResultReport(
  report: GameResultReport,
  secret: string,
): Promise<{ readonly body: string; readonly signature: string }> {
  const body = JSON.stringify(report);
  return { body, signature: await signMessage(RESULT_PURPOSE, body, secret) };
}

export type ResultReportVerification =
  | { readonly ok: true; readonly report: GameResultReport }
  | { readonly ok: false; readonly reason: 'bad_signature' | 'malformed' };

/**
 * Verifies a raw request body against its signature.
 *
 * Takes the body as the exact string that was received, never a re-serialised object:
 * re-encoding could change key order and invalidate an otherwise honest signature, or
 * worse, let a mismatch slip through.
 */
export async function verifyResultReport(
  body: string,
  signature: string | null,
  secret: string,
): Promise<ResultReportVerification> {
  if (signature === null || signature.length === 0) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!(await verifyMessage(RESULT_PURPOSE, body, signature, secret))) {
    return { ok: false, reason: 'bad_signature' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, reason: 'malformed' };
  }

  const record = parsed as Record<string, unknown>;
  if (
    typeof record.gameId !== 'string' ||
    record.gameId.length === 0 ||
    typeof record.state !== 'object' ||
    record.state === null
  ) {
    return { ok: false, reason: 'malformed' };
  }

  return {
    ok: true,
    report: { gameId: record.gameId, state: record.state as EncodedGameState },
  };
}
