/**
 * Short room codes for spec §7.4's "invite by code + link".
 *
 * A code is read aloud, typed on a phone and sent in a chat message, so the alphabet
 * drops every character that is ambiguous in those settings: no 0/O, no 1/I/L, no
 * vowels that could spell something unfortunate. What remains is 24 symbols.
 *
 * 6 characters over 24 symbols is about 191 million codes. Codes are short-lived and
 * only ever guessed against an open room, and a collision is caught by the unique
 * index rather than assumed away — see `createRoom`'s retry.
 */

/** No 0/O/1/I/L, and no vowels, so a code can neither be misread nor spell a word. */
const ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789';

export const ROOM_CODE_LENGTH = 6;

/** Matches the games_join_code_shape CHECK in the schema. */
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

export function generateRoomCode(length: number = ROOM_CODE_LENGTH): string {
  // Rejection-free: 256 is not a multiple of 28, so a plain modulo would bias the
  // first few symbols. Draw extra bytes and discard the out-of-range ones instead.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let code = '';

  while (code.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit && code.length < length) {
        code += ALPHABET[byte % ALPHABET.length];
      }
    }
  }

  return code;
}

/** Normalises what a human typed: case, spaces and hyphens are all forgiven. */
export function normaliseRoomCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replaceAll(/[\s-]/g, '');
  return ROOM_CODE_PATTERN.test(cleaned) ? cleaned : null;
}
