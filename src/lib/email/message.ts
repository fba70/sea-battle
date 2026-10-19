/**
 * What SeaDuel sends, and what sends it (spec §7.5, §7.14).
 *
 * One narrow interface with two implementations: a development outbox that keeps
 * messages in memory so they can be read and clicked locally, and — later — a
 * provider that posts them over HTTP. Nothing above this layer knows which is in
 * use, so connecting a real provider is a new file and one line of wiring, not a
 * rewrite of the flows.
 */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain text is the message; the HTML part is a courtesy. */
  readonly text: string;
  readonly html: string;
  /** The locale it was rendered in (spec §7.14), for tests and the dev outbox. */
  readonly locale: string;
}

export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * A transport that throws rather than pretending to send.
 *
 * Used when nothing is configured in production. Silently dropping a password
 * reset is worse than failing loudly: the person would wait for an email that was
 * never going anywhere.
 */
export const unconfiguredTransport: EmailTransport = {
  name: 'unconfigured',
  send: () => {
    throw new Error(
      'No email provider is configured; implement EmailTransport and select it in send.ts',
    );
  },
};
