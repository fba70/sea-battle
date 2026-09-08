/**
 * The Sea Battle rules engine.
 *
 * INVARIANT: everything under src/game is pure and dependency-free — no React,
 * no Next, no database, no network, no transport types. It is imported unchanged
 * by the UI, by the bot, and by whichever authoritative session layer OQ-2
 * settles on (Cloudflare Durable Objects, or Redis + a realtime provider).
 * An ESLint rule in eslint.config.mjs enforces this.
 *
 * Rule implementation (placement validation, turn resolution, the per-player view
 * filter that keeps un-revealed opponent cells off the wire) lands in the next step.
 */
export * from './constants';
export * from './types';
