import { clearOutbox, readOutbox } from '@/lib/email/outbox';

/**
 * The development mailbox (spec §7.5's verification and reset flows).
 *
 * Lets the whole flow be exercised locally — register, read the message, follow
 * the link — with no domain, no provider and no API key, and gives the browser
 * tests something to read a one-time link out of.
 *
 * SECURITY: this hands out live password-reset links, so it **fails closed**. It
 * exists only outside production, and the check is on the server's own
 * environment rather than on anything a caller can influence. In production the
 * route answers 404, exactly as if it had never been deployed.
 */
function availableHere(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export async function GET(): Promise<Response> {
  if (!availableHere()) {
    return new Response('Not found', { status: 404 });
  }

  return Response.json({ messages: readOutbox() }, { headers: { 'cache-control': 'no-store' } });
}

/** Empties the mailbox, so one test cannot read another's message. */
export async function DELETE(): Promise<Response> {
  if (!availableHere()) {
    return new Response('Not found', { status: 404 });
  }

  clearOutbox();
  return Response.json({ status: 'cleared' });
}
