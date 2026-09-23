/**
 * Signed connection tickets — the auth bridge from spec §5.2 ("session cookie shared
 * with the game layer via a signed token").
 *
 * The realtime layer runs on a different origin from the Next app, so the better-auth
 * cookie does not travel with the WebSocket. Instead the Next app, which *does* have
 * the session and the database, mints a short-lived ticket naming the game, the player
 * and the seat. The game layer only has to verify a signature, so it needs no database
 * and no auth stack of its own.
 *
 * SECURITY: the seat is inside the signed payload. A client cannot choose which seat it
 * connects as, and cannot connect to a game it was not given a ticket for. Forging one
 * requires the shared secret.
 *
 * Deliberately dependency-free and built on WebCrypto only, so the identical module runs
 * in Node (the Next app) and in workerd (the Durable Object).
 */
import type { PlayerSlot } from '@/game/types';

import { base64UrlDecode, base64UrlEncode, signMessage, verifyMessage } from './hmac';

/** Claims carried by a ticket. Keep this small — it is visible to the client. */
export interface GameTicketClaims {
  readonly gameId: string;
  readonly playerId: string;
  readonly seat: PlayerSlot;
  /** Expiry, epoch seconds. Tickets are for connecting, not for the whole match. */
  readonly exp: number;
}

export type TicketErrorCode =
  'malformed' | 'bad_signature' | 'expired' | 'invalid_claims' | 'missing_secret';

export interface TicketError {
  readonly code: TicketErrorCode;
  readonly message: string;
}

export type TicketResult =
  | { readonly ok: true; readonly claims: GameTicketClaims }
  | { readonly ok: false; readonly error: TicketError };

/** Default lifetime. Long enough to open a socket, short enough to be useless if leaked. */
export const DEFAULT_TICKET_TTL_SECONDS = 120;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Scopes the signature so a ticket can never be replayed as another signed message. */
export const TICKET_PURPOSE = 'seaduel.game-ticket.v1';

function isSeat(value: unknown): value is PlayerSlot {
  return value === 'a' || value === 'b';
}

/**
 * Mints a ticket. Called by the Next app *after* it has confirmed, from the session and
 * the database, that this player really holds this seat in this game.
 */
export async function mintGameTicket(
  claims: Omit<GameTicketClaims, 'exp'> & { readonly exp?: number },
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  if (secret.length === 0) {
    throw new Error('A ticket secret is required');
  }

  const payload: GameTicketClaims = {
    gameId: claims.gameId,
    playerId: claims.playerId,
    seat: claims.seat,
    exp: claims.exp ?? Math.floor(now.getTime() / 1000) + DEFAULT_TICKET_TTL_SECONDS,
  };

  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${body}.${await signMessage(TICKET_PURPOSE, body, secret)}`;
}

/**
 * Verifies a ticket. Every failure returns the same shape and never explains more than
 * the category — a caller learns "bad_signature", not which byte differed.
 */
export async function verifyGameTicket(
  token: string,
  secret: string,
  now: Date = new Date(),
): Promise<TicketResult> {
  if (secret.length === 0) {
    return { ok: false, error: { code: 'missing_secret', message: 'No ticket secret configured' } };
  }

  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) {
    return { ok: false, error: { code: 'malformed', message: 'Ticket is not well formed' } };
  }

  const body = token.slice(0, separator);
  if (!(await verifyMessage(TICKET_PURPOSE, body, token.slice(separator + 1), secret))) {
    return { ok: false, error: { code: 'bad_signature', message: 'Ticket signature is invalid' } };
  }

  const decoded = base64UrlDecode(body);
  if (!decoded) {
    return { ok: false, error: { code: 'malformed', message: 'Ticket is not well formed' } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(decoded));
  } catch {
    return { ok: false, error: { code: 'malformed', message: 'Ticket is not well formed' } };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: { code: 'invalid_claims', message: 'Ticket claims are invalid' } };
  }

  const record = parsed as Record<string, unknown>;
  if (
    typeof record.gameId !== 'string' ||
    record.gameId.length === 0 ||
    typeof record.playerId !== 'string' ||
    record.playerId.length === 0 ||
    !isSeat(record.seat) ||
    typeof record.exp !== 'number' ||
    !Number.isFinite(record.exp)
  ) {
    return { ok: false, error: { code: 'invalid_claims', message: 'Ticket claims are invalid' } };
  }

  // Checked only after the signature, so an unsigned payload cannot probe anything.
  if (record.exp * 1000 <= now.getTime()) {
    return { ok: false, error: { code: 'expired', message: 'Ticket has expired' } };
  }

  return {
    ok: true,
    claims: {
      gameId: record.gameId,
      playerId: record.playerId,
      seat: record.seat,
      exp: record.exp,
    },
  };
}
