# Server-authoritative game layer

Nothing lives here yet. This directory is reserved for the code that acts as the
**referee**: it owns board state, turn order, RNG, timers and results, and it is the
only place allowed to see both players' boards.

Rules from `CLAUDE.md` and spec §5.3 / §10 that govern this directory:

- The client is untrusted. It sends intents; this layer returns filtered events.
- A client must never receive un-revealed opponent ship positions. Every payload
  crossing the boundary is built by an explicit per-player view filter.
- All rule logic is imported from `src/game` (pure, transport-independent) rather
  than reimplemented here, so the same engine backs the UI, the bot, and the
  live session layer.

The transport is still an open question (**OQ-2**: Cloudflare Durable Objects /
PartyKit vs Upstash Redis + Ably/Pusher). Keeping the rules in `src/game` means that
decision only changes this directory.
