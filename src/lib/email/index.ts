/**
 * Transactional email (spec §7.5's verification and password reset, §7.14's
 * "rendered in the recipient's locale").
 *
 * `message.ts` is the contract, `templates.ts` renders the two messages in five
 * languages, `send.ts` chooses the transport, and `outbox.ts` is the development
 * mailbox that makes all of it testable with no provider and no domain.
 */
export * from './message';
export * from './outbox';
export * from './send';
export * from './templates';
