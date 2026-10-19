import { createDevOutbox } from './outbox';
import { unconfiguredTransport, type EmailMessage, type EmailTransport } from './message';

/**
 * Which transport actually carries the mail (spec §7.5, §7.14).
 *
 * Development uses the in-memory outbox, which is why none of this needs a
 * domain, a provider account or an API key to build and test against. Production
 * has no provider yet and therefore refuses to pretend: adding one means
 * implementing `EmailTransport` and naming it here.
 *
 * Failures are swallowed at the call site, never here. Whether a missing email
 * should break the action that triggered it is the caller's decision, and for a
 * sign-up the answer is no.
 */
let transport: EmailTransport | null = null;

export function emailTransport(): EmailTransport {
  if (transport) {
    return transport;
  }

  transport = process.env.NODE_ENV === 'production' ? unconfiguredTransport : createDevOutbox();
  return transport;
}

/** Replaces the transport. Test-only; production picks its own. */
export function setEmailTransport(next: EmailTransport | null): void {
  transport = next;
}

/**
 * Sends, and reports whether it worked rather than throwing.
 *
 * A verification email that cannot be sent must not fail the registration that
 * triggered it — the account is already created and the person is already
 * playing. A reset is different, and its caller treats a false here as a reason
 * to say so.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  try {
    await emailTransport().send(message);
    return true;
  } catch {
    return false;
  }
}
