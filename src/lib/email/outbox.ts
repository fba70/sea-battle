import type { EmailMessage, EmailTransport } from './message';

/**
 * The development mailbox (spec §7.5's verification and reset flows).
 *
 * Mail is kept in memory in the running server and read back through a
 * development-only route, so the whole flow — register, open the message, click
 * the link — can be exercised locally and in tests without a domain, a provider,
 * an API key or a single real email leaving the machine.
 *
 * In memory rather than on disk on purpose: it disappears with the server, so
 * nothing can leak a reset link into the repository or a backup.
 */

/**
 * Enough to inspect a flow; old messages fall off the end.
 *
 * Generous because the browser suite runs in parallel and every sign-up it makes
 * sends a message: a tight buffer would evict a test's own link before it got to
 * read it.
 */
const CAPACITY = 200;

export interface StoredEmail extends EmailMessage {
  readonly id: number;
  readonly sentAt: string;
  /** Every link found in the message, so a test can follow one without parsing. */
  readonly links: readonly string[];
}

const LINK = /https?:\/\/[^\s<>"')]+/g;

let nextId = 1;
let messages: StoredEmail[] = [];

export function createDevOutbox(): EmailTransport {
  return {
    name: 'dev-outbox',
    send: async (message: EmailMessage) => {
      const stored: StoredEmail = {
        ...message,
        id: nextId,
        sentAt: new Date().toISOString(),
        links: [...new Set(message.text.match(LINK) ?? [])],
      };

      nextId += 1;
      messages = [stored, ...messages].slice(0, CAPACITY);
    },
  };
}

/** Newest first. */
export function readOutbox(): readonly StoredEmail[] {
  return messages;
}

export function clearOutbox(): void {
  messages = [];
}
