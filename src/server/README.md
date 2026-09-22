# Server-authoritative game layer

This directory holds the **referee**: the only code allowed to see both players'
boards. It owns board state, turn order, RNG, timers and results. `session/` is the
transport-independent core of it; the adapter that carries bytes arrives with OQ-2.

Rules from `CLAUDE.md` and spec §5.3 / §10 that govern this directory:

- The client is untrusted. It sends intents; this layer returns filtered events.
- A client must never receive un-revealed opponent ship positions. Every payload
  crossing the boundary is built by an explicit per-player view filter.
- All rule logic is imported from `src/game` (pure, transport-independent) rather
  than reimplemented here, so the same engine backs the UI, the bot, and the
  live session layer.

## `session/` — Phase 1, Block 1 (added 2026-09-22)

- `protocol.ts` — the spec §9 contract: Zod schemas for every client→server intent,
  the server→client event types, and the session error vocabulary. Schemas validate
  _structure only_; legality is the engine's. The §9 intent is wrapped in an envelope
  carrying a `seq`, because §9 defines no sequencing field but §10 requires one.
- `session.ts` — `GameSession`: owns the authoritative `GameState`, resolves a player
  id to a seat, applies intents through `src/game`, and returns **per-recipient** §9
  events built by `createPlayerView(state, seat)`. Pure and immutable: no clock, no
  RNG, no I/O, so a session replays identically from its inputs.
- `src/game/codec.ts` — makes `GameState` storable. `shots`/`revealedEmpty` are `Set`s,
  so `JSON.stringify` silently drops them; the codec is the only safe way to persist or
  ship authoritative state, and it re-validates fleets through `validateFleet` on decode.

Not built yet, by design: timers, reconnection, resign/forfeit, reactions, matchmaking,
rooms, ratings and persistence. Those are Blocks 5–12.

An ESLint rule keeps `session/` free of sockets, realtime providers, the database and
the UI, so the OQ-2 decision only ever costs us an adapter.

The transport is still an open question (**OQ-2**: Cloudflare Durable Objects /
PartyKit vs Upstash Redis + Ably/Pusher). Keeping the rules in `src/game` means that
decision only changes this directory.

## Decision: Phase 0 bot games run client-side (accepted 2026-09-22)

The Phase 0 bot match runs entirely in the browser. `GameState` — which holds both
fleets — lives in React state, and only `createPlayerView()` output reaches the
component tree. That boundary is enforced by an ESLint rule and by differential
tests, but it is **discipline, not a trust boundary**: a determined player can read
both fleets out of the JS heap.

This is accepted for Phase 0, on these grounds:

- §4 makes bot games **unrated**, so there is no rating to protect and nothing for a
  cheater to gain beyond spoiling their own game.
- §13 places the realtime session layer in **Phase 1**; Phase 0 lists no server
  game component.
- §15 is titled "MVP Definition of Done (**Phase 0 + core of Phase 1**)", so its
  "placement enforces the full ruleset server-side" line is satisfied in Phase 1,
  when the session layer that can enforce it exists.
- **OQ-2 is unresolved.** Building server authority now would mean building it
  against a transport we have not chosen, then rebuilding it.

What this does _not_ relax: rated and live play (§7.4, §7.6) must be
server-authoritative from the moment they exist. Because `src/game` is pure and
transport-independent, moving it behind the referee is wiring, not a rewrite.
