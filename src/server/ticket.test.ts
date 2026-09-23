import { describe, expect, it } from 'vitest';

import { signMessage } from './hmac';
import {
  mintGameTicket,
  verifyGameTicket,
  DEFAULT_TICKET_TTL_SECONDS,
  TICKET_PURPOSE,
} from './ticket';

const SECRET = 'a-sufficiently-long-shared-ticket-secret';
const OTHER_SECRET = 'a-different-shared-ticket-secret-value';
const NOW = new Date('2026-09-23T12:00:00Z');

const CLAIMS = { gameId: 'game-1', playerId: 'player-a', seat: 'a' } as const;

describe('minting and verifying', () => {
  it('round-trips the claims', async () => {
    const token = await mintGameTicket(CLAIMS, SECRET, NOW);
    const result = await verifyGameTicket(token, SECRET, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims).toMatchObject(CLAIMS);
    }
  });

  it('defaults to a short lifetime', async () => {
    const token = await mintGameTicket(CLAIMS, SECRET, NOW);
    const result = await verifyGameTicket(token, SECRET, NOW);

    expect(result.ok && result.claims.exp).toBe(
      Math.floor(NOW.getTime() / 1000) + DEFAULT_TICKET_TTL_SECONDS,
    );
  });

  it('produces a url-safe token', async () => {
    const token = await mintGameTicket(CLAIMS, SECRET, NOW);

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it('refuses to mint without a secret', async () => {
    await expect(mintGameTicket(CLAIMS, '', NOW)).rejects.toThrow();
  });
});

describe('a ticket cannot be forged or altered', () => {
  it('rejects a ticket signed with a different secret', async () => {
    const token = await mintGameTicket(CLAIMS, OTHER_SECRET, NOW);
    const result = await verifyGameTicket(token, SECRET, NOW);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('bad_signature');
  });

  it('rejects a tampered seat — a client cannot choose which seat it plays', async () => {
    // The whole point of signing: the seat is server-assigned.
    const token = await mintGameTicket(CLAIMS, SECRET, NOW);
    const [body, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(body as string, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    claims.seat = 'b';
    const forgedBody = Buffer.from(JSON.stringify(claims)).toString('base64url');

    const result = await verifyGameTicket(`${forgedBody}.${signature}`, SECRET, NOW);
    expect(!result.ok && result.error.code).toBe('bad_signature');
  });

  it('rejects a tampered game id', async () => {
    const token = await mintGameTicket(CLAIMS, SECRET, NOW);
    const [body, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(body as string, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    claims.gameId = 'someone-elses-game';
    const forgedBody = Buffer.from(JSON.stringify(claims)).toString('base64url');

    const result = await verifyGameTicket(`${forgedBody}.${signature}`, SECRET, NOW);
    expect(!result.ok && result.error.code).toBe('bad_signature');
  });

  const MALFORMED: readonly [string, string][] = [
    ['an empty token', ''],
    ['no separator', 'abcdef'],
    ['an empty body', '.signature'],
    ['an empty signature', 'body.'],
    ['a non-base64 signature', 'aGVsbG8.****'],
    ['random text', 'this is not a ticket'],
  ];

  for (const [label, token] of MALFORMED) {
    it(`rejects ${label}`, async () => {
      const result = await verifyGameTicket(token, SECRET, NOW);

      expect(result.ok).toBe(false);
      expect(!result.ok && ['malformed', 'bad_signature']).toContain(
        !result.ok ? result.error.code : '',
      );
    });
  }

  it('rejects a correctly signed payload that is not a ticket', async () => {
    // Signed with the right secret *and* the right purpose, but the claims are
    // nonsense — a valid signature alone is never enough.
    const body = Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url');
    const signature = await signMessage(TICKET_PURPOSE, body, SECRET);

    const result = await verifyGameTicket(`${body}.${signature}`, SECRET, NOW);
    expect(!result.ok && result.error.code).toBe('invalid_claims');
  });

  it('rejects a signature minted for a different purpose', async () => {
    // The same secret signs game-result reports. Scoping by purpose stops one kind of
    // signed message being presented as another.
    const body = Buffer.from(
      JSON.stringify({ gameId: 'game-1', playerId: 'player-a', seat: 'a', exp: 1e10 }),
    ).toString('base64url');
    const signature = await signMessage('seaduel.some-other-purpose', body, SECRET);

    const result = await verifyGameTicket(`${body}.${signature}`, SECRET, NOW);
    expect(!result.ok && result.error.code).toBe('bad_signature');
  });

  it('rejects a seat that is not a or b', async () => {
    const result = await verifyGameTicket(
      await mintGameTicket({ ...CLAIMS, seat: 'c' as unknown as 'a' }, SECRET, NOW),
      SECRET,
      NOW,
    );

    expect(!result.ok && result.error.code).toBe('invalid_claims');
  });

  it('refuses to verify when no secret is configured', async () => {
    const token = await mintGameTicket(CLAIMS, SECRET, NOW);
    const result = await verifyGameTicket(token, '', NOW);

    expect(!result.ok && result.error.code).toBe('missing_secret');
  });
});

describe('expiry', () => {
  it('accepts a ticket inside its window', async () => {
    const token = await mintGameTicket(CLAIMS, SECRET, NOW);
    const later = new Date(NOW.getTime() + (DEFAULT_TICKET_TTL_SECONDS - 5) * 1000);

    expect((await verifyGameTicket(token, SECRET, later)).ok).toBe(true);
  });

  it('rejects a ticket past its window', async () => {
    const token = await mintGameTicket(CLAIMS, SECRET, NOW);
    const later = new Date(NOW.getTime() + (DEFAULT_TICKET_TTL_SECONDS + 5) * 1000);

    const result = await verifyGameTicket(token, SECRET, later);
    expect(!result.ok && result.error.code).toBe('expired');
  });

  it('checks the signature before the expiry, so an unsigned payload probes nothing', async () => {
    const expired = await mintGameTicket(
      { ...CLAIMS, exp: Math.floor(NOW.getTime() / 1000) - 1 },
      OTHER_SECRET,
      NOW,
    );

    const result = await verifyGameTicket(expired, SECRET, NOW);
    expect(!result.ok && result.error.code).toBe('bad_signature');
  });
});

describe('error messages disclose nothing', () => {
  it('never echoes the token or the secret', async () => {
    const token = await mintGameTicket(CLAIMS, OTHER_SECRET, NOW);
    const result = await verifyGameTicket(token, SECRET, NOW);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain(token);
      expect(result.error.message).not.toContain(SECRET);
      expect(result.error.message).not.toContain(OTHER_SECRET);
    }
  });
});
