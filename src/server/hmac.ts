/**
 * The HMAC-SHA256 primitive shared by every signed message between the Next app and
 * the realtime layer (connection tickets, game-result reports).
 *
 * WebCrypto only and dependency-free, so the identical code runs in Node and in
 * workerd. One implementation means one place to get constant-time comparison and
 * base64url encoding right.
 */

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function base64UrlDecode(value: string): Uint8Array | null {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  try {
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Length-independent comparison, so a mismatch leaks no position information. */
export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] as number) ^ (right[index] as number);
  }
  return difference === 0;
}

/**
 * Signs `message` under `secret`, scoped to `purpose`.
 *
 * The purpose is mixed into the signed bytes so a signature minted for one kind of
 * message can never be replayed as another — a connection ticket cannot be presented
 * as a game result, even though both are signed with the same secret.
 */
export async function signMessage(
  purpose: string,
  message: string,
  secret: string,
): Promise<string> {
  if (secret.length === 0) {
    throw new Error('A signing secret is required');
  }

  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(`${purpose}.${message}`),
  );

  return base64UrlEncode(new Uint8Array(signature));
}

export async function verifyMessage(
  purpose: string,
  message: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (secret.length === 0) {
    return false;
  }

  const provided = base64UrlDecode(signature);
  if (!provided) {
    return false;
  }

  const expected = base64UrlDecode(await signMessage(purpose, message, secret));
  return expected !== null && timingSafeEqual(provided, expected);
}
