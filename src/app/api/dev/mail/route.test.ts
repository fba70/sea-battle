import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearOutbox, createDevOutbox } from '@/lib/email/outbox';
import { sendEmail, setEmailTransport } from '@/lib/email/send';
import { verificationEmail } from '@/lib/email/templates';

/**
 * The development mailbox hands out live one-time links, so the thing that
 * matters most about it is that production cannot reach it at all.
 */
const original = process.env.NODE_ENV;

beforeEach(() => {
  // No module reset: the route reads the environment when it is called, and a
  // reset would hand it a different copy of the outbox from the one seeded here.
  clearOutbox();
  setEmailTransport(createDevOutbox());
});

afterEach(() => {
  vi.stubEnv('NODE_ENV', original ?? 'test');
  setEmailTransport(null);
});

async function get(): Promise<Response> {
  const { GET } = await import('./route');
  return GET();
}

describe('the development mailbox', () => {
  it('lists what has been sent', async () => {
    await sendEmail(
      verificationEmail({ to: 'player@example.test', url: 'http://x/verify', locale: 'en' }),
    );

    const body = (await (await get()).json()) as { messages: { to: string }[] };
    expect(body.messages[0]?.to).toBe('player@example.test');
  });

  it('does not exist in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    // Fails closed: a 404, exactly as if the route had never been deployed.
    expect((await get()).status).toBe(404);
  });

  it('refuses to clear the mailbox in production either', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { DELETE } = await import('./route');

    expect((await DELETE()).status).toBe(404);
  });

  it('can be emptied between tests', async () => {
    await sendEmail(verificationEmail({ to: 'a@b.test', url: 'http://x', locale: 'en' }));
    const { DELETE } = await import('./route');
    await DELETE();

    const body = (await (await get()).json()) as { messages: unknown[] };
    expect(body.messages).toEqual([]);
  });
});
