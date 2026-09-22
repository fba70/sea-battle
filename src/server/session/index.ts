/**
 * The transport-independent authoritative game session (Phase 1, Block 1).
 *
 * `protocol.ts` defines the spec §9 contract and validates untrusted input;
 * `session.ts` is the referee that applies it with the `src/game` rules engine.
 * Nothing here knows how bytes reach a client — that adapter arrives with OQ-2.
 */
export * from './protocol';
export * from './session';
