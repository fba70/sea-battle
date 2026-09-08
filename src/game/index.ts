/**
 * The Sea Battle rules engine (Classic ruleset, spec §4).
 *
 * INVARIANT: everything under src/game is pure and dependency-free — no React,
 * no Next, no database, no network, no transport types. It is imported unchanged
 * by the UI, by the bot, and by whichever authoritative session layer OQ-2
 * settles on (Cloudflare Durable Objects, or Redis + a realtime provider).
 * An ESLint rule in eslint.config.mjs enforces this.
 *
 * The engine is also deterministic and immutable: no `Math.random`, no `Date.now`,
 * and every transition returns a new state rather than mutating its input.
 *
 * SECURITY: `GameState` holds BOTH fleets. Never serialise it to a client —
 * send `createPlayerView(state, slot)` (or `createPublicView(state)`) instead.
 */
export * from './autoplace';
export * from './constants';
export * from './coord';
export * from './fire';
export * from './placement';
export * from './result';
export * from './rng';
export * from './state';
export * from './types';
export * from './view';
