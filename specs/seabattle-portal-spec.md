# Sea Battle Portal — Build Specification

**Working title:** SeaDuel (placeholder)
**Reference:** https://morebattle.ru/ (Russian Battleship variant)
**Status:** Draft v0.3 — for Claude Code handoff (adds §7.13 Cosmetics, §7.14 i18n)
**Target stack:** Next.js 15 (App Router) · Tailwind · shadcn/ui · Vercel · Neon Postgres + Drizzle · Upstash Redis · better-auth · Cloudflare (Durable Objects for game sessions, R2 for assets)

---

## 1. Overview & Vision

A polished, web-only real-time Sea Battle (Battleship) portal. A player can start in one click without an account (guest), play against a bot or a live opponent, and — once hooked — register by email to keep their rating, history, and achievements. The product differentiates from the toy reference on three axes: **feel** (modern board, animation, sound), **fairness** (server-authoritative anti-cheat + Glicko-1), and **depth** (leaderboard, tournaments, onboarding).

The reference site's implicit product decisions we adopt: instant play without registration, private-room-by-code, a 3-level bot, Classic + Salvo modes, emoji reactions, auto-reconnect, and a donate-to-support model with no ads and no paywalled features.

### Guiding principles
- **Zero-friction start.** First shot fired within seconds of landing, no signup wall.
- **Server is the referee.** The client never holds the opponent's board; the server validates every move. This is a rating-bearing game — cheating protection is a P0, not a nice-to-have.
- **Progress is portable.** Guests can convert to accounts and keep everything.
- **Mobile-first responsive**, single codebase, looks intentional on a 27" monitor and a phone browser alike.

---

## 2. Goals & Non-Goals

### Goals
1. A player reaches "first shot fired" in under ~10s from landing (guest, vs bot), no signup.
2. Two strangers are matched into a rated live game via quick-match in under ~30s at typical concurrency.
3. Rated results feel fair and legible: a correct Glicko-1 rating that moves sensibly, visible on a leaderboard.
4. A player can run and complete a small single-elimination tournament end to end.
5. The game is provably hard to cheat: no client-side authority over hit/miss, board contents, or turn order.
6. Runs comfortably on Vercel's free/low tiers at launch scale; costs scale with real usage, not idle.

### Non-Goals (v1)
1. **Native mobile apps.** Web only; responsive design covers mobile browsers.
2. **In-app payment processing.** Support is an outbound link to a payment provider — no cards, no PCI scope, no checkout in-app.
3. **Social graph / friends list / chat.** v1 has invite-by-link and in-game emoji reactions only; no persistent messaging or friend system.
4. **Ranked seasons, ladders, MMR decay.** One continuous Glicko-1 rating in v1; seasons are a v2 idea.
5. **Spectator mode / replays sharing.** Game history is private to the player in v1.
6. **Locales beyond the supported five.** UI + content ship in **English, German, Spanish, Italian, French** (see §7.14). Other languages, and RTL support, are out of scope for v1. **No Russian.** (The reference is Russian, but this product does not target that market.)
7. **Custom board sizes / fleet editors.** Fixed 10×10 classic fleet; alternate rulesets are P2.

---

## 3. Personas & User Stories

**Casual drop-in (guest).** Wants a quick game, no commitment.
- As a guest, I want to play against a bot immediately so that I can try the game with zero setup.
- As a guest, I want to play a friend by sharing a link so that we can duel without either of us registering.
- As a guest, I want a prompt to save my progress after a good game so that I don't lose my streak/rating.

**Regular competitive player (registered).**
- As a registered player, I want a rated quick-match against a similarly-skilled stranger so that my games feel competitive.
- As a registered player, I want my Glicko-1 rating and rank on the leaderboard so that I can track improvement.
- As a registered player, I want match history and per-game stats so that I can review my play.
- As a registered player, I want to earn badges for wins, accuracy, and streaks so that there's a reason to return.

**Tournament organizer / participant.**
- As an organizer, I want to create a scheduled single-elimination tournament with a registration window so that players can compete for a title.
- As a participant, I want to register, see the bracket, and get auto-paired each round so that I don't have to coordinate manually.

**Supporter.**
- As a fan, I want a clearly-labeled donate button so that I can support the project.

**Edge/负 cases to design for.**
- As a player, if I lose connection mid-game, I want to auto-reconnect and resume so that a network blip doesn't cost me the match.
- As a player, if my opponent rage-quits, I want to win by forfeit and keep the rating gain so that abandonment isn't rewarded.
- As a player on a slow move, I want a visible per-move timer so that stalling is bounded.

---

## 4. Game Rules & Modes (authoritative ruleset)

Default ruleset follows the Russian Морской бой variant (matching the reference), configurable per game type.

### Board & fleet
- Board: **10×10** grid, columns A–J (or 1–10), rows 1–10.
- Fleet (10 ships, 20 cells):
  - 1 × 4-deck (battleship)
  - 2 × 3-deck (cruisers)
  - 3 × 2-deck (destroyers)
  - 4 × 1-deck (submarines)
- **Placement constraint:** ships are straight (horizontal/vertical), must be fully on-board, and **may not touch each other — not even diagonally** (a one-cell "buffer" around every ship). The server validates this; auto-placement guarantees it.

### Turn structure — Classic
- Players alternate turns. On your turn you fire at one cell.
- **Hit → you fire again.** **Miss → turn passes** to the opponent. (Russian rule; differs from Western alternate-every-shot. Store as a rule flag so Western mode is a later toggle.)
- A cell can't be fired at twice; the server rejects repeats.
- When a ship's last cell is hit it is **sunk**; the server reveals the full ship outline and auto-marks the surrounding buffer cells as known-empty (standard convenience so players don't waste shots on cells that provably can't hold a ship).
- **Win:** first player to sink all 10 opponent ships.

### Turn structure — Salvo
- Each turn a player fires a **salvo of N shots at once**, where N = number of the firing player's **surviving** ships (starts at 10, shrinks as your ships sink). Both salvo cells are chosen before resolution.
- Server resolves the whole salvo, returns hit/miss/sink per cell. Turn then passes (no extra-turn-on-hit in Salvo). Faster games; higher variance.

### Timers & abandonment
- **Per-move timer** (default 30s Classic / 45s Salvo, configurable). On expiry: auto-skip in Classic (counts as a miss/turn pass) or auto-forfeit after K consecutive expiries; in Salvo, auto-fire random valid cells or forfeit — decide in tuning (Open Question OQ-3).
- **Placement timer** at game start (default 60s). On expiry → auto-placement applied.
- **Disconnect grace:** 30s to reconnect (reference advertises auto-reconnect). Beyond grace → forfeit; opponent wins; rating applies as a normal win/loss.
- **Rage-quit / explicit leave** = immediate forfeit.

### Rated vs unrated
- Bot games: **unrated** (never affect Glicko).
- Private-room (friend) games: **unrated by default**, optional "rated" toggle only if both are registered.
- Quick-match between two registered players: **rated**.
- Guest live games: unrated (no persistent identity to rate). Encourage registration to unlock rated.

---

## 5. System Architecture

### 5.1 The hard part: authoritative real-time state

Battleship is turn-based and low-frequency, but it is **adversarial with hidden information and a rating attached**. Two hard requirements drive the architecture:

1. **The opponent's board must never reach the client** until cells are legitimately revealed (sink/game-over). A client that receives the full board can trivially cheat.
2. **Hit/miss/turn/win must be computed by a trusted party**, not asserted by a client.

**Recommended design — one authoritative actor per live game.**

Use **Cloudflare Durable Objects** (directly, or via **PartyKit** for ergonomics) as the game-session layer. Each active game = one Durable Object instance that:
- Holds both boards + turn state in memory (single-writer, no race conditions).
- Accepts moves over WebSocket, validates them, computes results, and pushes **per-player filtered views** (each socket only ever sees its own full board + the opponent's *revealed* cells).
- Owns the move/placement/disconnect timers (DO alarms).
- On game end, writes the completed game + result to Neon and triggers rating update.

Rationale: DOs give you a durable, single-threaded referee with built-in WebSocket hibernation, presence, and timers — exactly Battleship's needs — and you already run Cloudflare (R2) in your stack. Vercel serverless functions cannot hold long-lived authoritative game state or sockets cheaply.

**Pragmatic Vercel-native alternative (if you want to avoid DOs at MVP):** authoritative state in **Upstash Redis** (already in your stack), moves via `POST /api/games/[id]/move` Route Handlers that read-modify-write Redis under an optimistic lock, and push updates to both clients via a managed realtime channel (**Ably** or **Pusher**). Turn-based low-QPS makes the per-move Redis round-trip perfectly acceptable. Timers become scheduled checks (Upstash QStash / Vercel Cron sweeping for expired turns). This is simpler to ship but spreads authority across function invocations; the DO approach is cleaner for correctness and timers. **Recommendation: DO/PartyKit for the session layer; keep everything else Vercel-native.**

Whichever is chosen, the **contract is identical**: clients send *intents* (place fleet, fire cell(s), react, resign); the server returns *authoritative events* (see §10 protocol).

### 5.2 Component map

- **Next.js 15 (App Router) on Vercel** — all pages, the lobby/board UI, REST route handlers for non-realtime ops (auth, profile, leaderboard, tournaments, matchmaking enqueue).
- **Game session layer** — Cloudflare Durable Objects / PartyKit (or Redis+Ably fallback). Authoritative live game state.
- **Neon Postgres + Drizzle ORM** — durable data: users, ratings, completed games, badges, tournaments, leaderboard snapshots.
- **Upstash Redis** — matchmaking queue (sorted set keyed by rating), private-room code registry, presence, rate limiting, ephemeral lobby state.
- **better-auth** — anonymous (guest) sessions + email/password; guest→account claim/merge. Session cookie shared with the game layer via a signed token.
- **Cloudflare R2** — static game art/sprites, sound files, onboarding slides/video (or use a video host — see §9.9).
- **Analytics/observability** — Vercel Analytics + a product-analytics tool (PostHog recommended); structured logs from the session layer.

### 5.3 Trust boundary

The client is untrusted. It renders state it's told and sends intents. All rule enforcement, hidden-information filtering, RNG (bot moves, matchmaking, tournament seeding), timers, and rating math live server-side. The client's board-placement UI produces a *proposed* placement that the server re-validates.

Optional hardening (P2): **commit–reveal** fleet placement (client sends a salted hash of its board at game start, reveals at game end; server verifies the board never changed) so a player can *prove* the server didn't alter their fleet. Not needed while the server is the sole authority, but nice for a "provably fair" claim.

---

## 6. Data Model (Neon + Drizzle)

Sketch; refine during implementation. Types indicative.

- **`users`** — `id`, `role` ('guest' | 'user'), `email` (nullable for guests), `email_verified`, `password_hash` (better-auth-managed), `display_name`, `avatar_seed`, `country` (nullable), `locale` ('en'|'de'|'es'|'it'|'fr', default resolved from `Accept-Language`; see §7.14), `created_at`, `last_seen_at`, `claimed_from_guest_id` (nullable).
- **`ratings`** — `user_id` (PK/FK), `rating` (default 1500), `rd` (rating deviation, default 350), `volatility_or_reserved`, `last_rating_period_at`, `games_rated`. (Glicko-1 uses rating + RD; keep a column reserved if you later move to Glicko-2 which adds volatility σ.)
- **`games`** — `id`, `mode` ('classic' | 'salvo'), `type` ('bot' | 'private' | 'quickmatch'), `rated` (bool), `player_a_id`, `player_b_id` (nullable for bot; store bot level), `winner_id` (nullable), `result_reason` ('sunk_all' | 'forfeit' | 'timeout' | 'disconnect'), `started_at`, `ended_at`, `move_count`, `ruleset_json`, `boards_json` (final boards, for history/review), `rating_delta_a`, `rating_delta_b`.
- **`game_events`** (optional, for replay/audit) — `game_id`, `seq`, `actor`, `type`, `payload_json`, `ts`. Can be append-only; prune old rows.
- **`badges`** — catalog: `code`, `name_i18n` (JSONB map `{en,de,es,it,fr}`, EN required), `description_i18n` (JSONB map), `icon`, `criteria_json`. (User-facing catalog text is localized in-row — see §7.14.)
- **`user_badges`** — `user_id`, `badge_code`, `earned_at`.
- **`streaks`** — `user_id`, `current_streak`, `best_streak`, `last_active_date`.
- **`tournaments`** — `id`, `name`, `format` ('single_elim' | ...), `mode`, `rated` (bool), `status` ('draft'|'registration'|'live'|'completed'|'cancelled'), `max_players`, `registration_opens_at`, `starts_at`, `created_by`, `settings_json`.
- **`tournament_entrants`** — `tournament_id`, `user_id`, `seed`, `status`, `eliminated_round`.
- **`tournament_matches`** — `tournament_id`, `round`, `slot`, `player_a_id`, `player_b_id` (nullable = bye), `game_id` (nullable until played), `winner_id`, `status`.
- **`leaderboard_snapshots`** (optional cache) — periodic materialized top-N for fast reads.
- **`cosmetic_items`** — catalog: `code` (PK), `category` ('board_theme' | 'ship_skin' | 'effect_pack' | 'victory_effect' | 'avatar_frame' | 'emoji_pack' | 'name_flair'), `name_i18n` (JSONB map `{en,de,es,it,fr}`, EN required), `description_i18n` (JSONB map), `rarity` ('starter'|'common'|'rare'|'epic'|'legendary'), `manifest_json` (render tokens / asset refs — see §7.13), `preview_asset`, `acquisition` ('starter'|'earned'|'tournament'|'supporter'|'purchase'), `price_minor` (nullable; integer minor units), `currency` (nullable), `enabled` (bool), `available_from`/`available_until` (nullable, for limited/rotating), `sort`.
- **`user_cosmetics`** (ownership) — `user_id`, `item_code`, `source` ('starter'|'earned'|'tournament'|'supporter'|'purchase'), `acquired_at`, `expires_at` (nullable, for rentals/limited grants). PK (`user_id`, `item_code`).
- **`user_loadout`** (equipped) — `user_id`, `category`, `item_code`. PK (`user_id`, `category`) so exactly one equipped item per category; equipped item must exist in `user_cosmetics` (enforced at equip time).
- **`purchases`** (only if/when paid cosmetics ship — Phase 3) — `id`, `user_id`, `provider` ('stripe'|…), `provider_ref` (checkout/session id, unique for idempotency), `item_codes_json` (or bundle ref), `amount_minor`, `currency`, `status` ('pending'|'paid'|'refunded'|'failed'), `created_at`. Entitlements granted by webhook, keyed on `provider_ref` for idempotent, exactly-once grants.
- *(Optional, P3)* **`cosmetic_bundles`** / **`bundle_items`** for packs; **`user_wallet`** + **`currency_ledger`** if a soft earn-by-play currency is introduced (see OQ-8).

Indices: `ratings(rating desc)` for leaderboard, `games(player_a_id/player_b_id, ended_at)` for history, `tournament_matches(tournament_id, round)`, `user_cosmetics(user_id)` and `user_loadout(user_id)` for locker/loadout reads, unique `purchases(provider_ref)` for idempotency.

---

## 7. Feature Specifications

Each maps to your 11 requirements. Priority tags: **P0** = MVP-blocking, **P1** = fast-follow, **P2** = future.

### 7.1 Board UI, graphics & animation — *Req 2* (P0)

**Visual direction.** Modern, clean, slightly playful naval theme; dark default (reference uses `#0f172a`/slate). Two facing boards on desktop (your fleet + firing grid), stacked/tabbed on mobile. Cells are crisp, generously sized touch targets (≥40px on mobile). Avoid skeuomorphic clutter; lean on motion and a tight palette.

**Rendering.** Grid via CSS/Tailwind; ships and effects via SVG or lightweight canvas layers. Prefer SVG + Framer Motion for the board (easy hit-testing, accessible, animatable) and reserve canvas for particle bursts if needed. Do **not** put game logic in the render layer.

**Animations (all respect `prefers-reduced-motion`):**
- Ship placement: drag to move, tap/right-click or rotate button to rotate; invalid placement flashes red with a subtle shake; valid drop snaps with a soft settle.
- Firing: shot travels/impacts; **miss** = water splash ripple; **hit** = impact + flame flicker; **sink** = ship revealed with a "sinking"/darken sequence and buffer cells auto-marked; **turn change** = clear affordance for whose turn it is.
- Victory/defeat: full-screen but brief celebratory/somber transition; show rating delta counting up/down.
- Emoji reactions: float-and-fade over the board.

**Accessibility.** Full keyboard play (arrow-key cursor + fire key), ARIA grid semantics, colorblind-safe hit/miss encoding (shape + color, not color alone), reduced-motion fallback to instant state changes.

**Acceptance criteria**
- [ ] Given a placement phase, when I drag/rotate a ship into an illegal position (off-board or touching), then the drop is rejected with a visible invalid cue and the ship returns to a legal spot.
- [ ] Given a fire, when the server returns hit/miss/sink, then the correct animation plays and board state matches the server exactly.
- [ ] Given `prefers-reduced-motion`, animations are replaced by instant, non-flashing state updates.
- [ ] The board is fully playable via keyboard and screen-reader-labeled.

### 7.2 Sound — *Req 3* (P0 for toggle + core SFX)

- SFX for: place ship, invalid, fire, splash (miss), hit, sink, your-turn, victory, defeat, emoji reaction, UI click. Optional light ambient loop (off by default).
- Library: **Howler.js** (or Web Audio directly) with a preloaded sprite sheet to avoid per-shot latency.
- **Mute toggle** in-game and in settings; state persisted per user (DB) and per device (localStorage) so it survives reload and is respected before login. Separate SFX vs music toggles (P1).
- Autoplay policy: initialize audio context on first user gesture; never auto-play sound before interaction.
- Volume slider (P1).

**Acceptance criteria**
- [ ] Sound is off ⇒ no audio plays anywhere; the setting persists across reloads and sessions.
- [ ] Firing produces its SFX with no perceptible delay after the first interaction.
- [ ] No audio plays before a user gesture (browser autoplay compliance).

### 7.3 AI bot — *Req 4 (vs AI)* (P0)

Three server-side difficulty levels (bot moves computed server-side to keep parity with the trust model). Bot games are always unrated.

- **Easy — random.** Uniform random valid target; no repeat. Random legal placement.
- **Medium — hunt/target + parity.** Search phase fires on a checkerboard/parity pattern (a ship of length ≥2 must cover at least one parity cell, halving the search). On a hit, switch to target mode: probe orthogonal neighbors; once two in-line hits, continue along the line until sink. Balanced placement (some edge bias).
- **Hard — probability density.** Each turn, compute for every un-fired cell how many placements of each *remaining* ship are consistent with all known hits/misses/sinks; fire the highest-probability cell. In target mode, heavily weight cells extending known hit lines. This is the strong classic approach and gives a genuinely tough opponent. Placement: avoid predictable patterns; optionally bias against edges/adjacency clustering.

Add small **randomized "thinking" delays** (e.g. 300–900ms) so the bot feels human-paced, not instant.

**Acceptance criteria**
- [ ] Easy never repeats a cell and completes games without stalling.
- [ ] Medium demonstrably targets adjacent cells after a hit and finishes ships efficiently.
- [ ] Hard's average shots-to-win is significantly lower than Medium's over a benchmark of N simulated games (define target in tuning).
- [ ] Bot placements always satisfy the no-touching constraint.

### 7.4 Multiplayer & matchmaking — *Req 4 (vs opponents)* (P0)

**Quick match (random opponent).**
- Player enqueues (mode + rated flag) into an Upstash Redis sorted set keyed by Glicko rating.
- Matcher pairs the closest-rated waiting player within a window that **expands over wait time** (e.g. ±50 → ±100 → ±200 → any) so lonely queues still resolve. Guests match into a separate unrated pool (or ±wide, no rating).
- On match: create a game session (DO/room), notify both clients, transition to placement.
- Concurrency safety: pairing must be atomic (Redis Lua or a leased-pop) so two matchers can't grab the same player.

**Private room with a friend (invite by code + link).**
- Creator picks mode/settings → server mints a short **room code** + shareable URL (`/play/room/<code>`). Store code→room in Redis with TTL.
- Friend opens link (or enters code) → joins the same session. This is the reference's core "play with a friend" mechanism, and the popular pattern for this genre.
- Optional "rated" toggle if both are registered.

**Reconnection.** Session persists briefly on disconnect; client re-attaches via game id + auth token and receives current filtered state. Within grace window the game continues; beyond it, forfeit.

**Emoji reactions.** A small fixed set of reactions relayed through the session to the opponent (no free text in v1 → moderation-free).

**Acceptance criteria**
- [ ] Two players enqueuing for the same mode are matched and land in placement within the target time.
- [ ] The matcher never pairs one waiting player into two games (atomic pop verified under concurrent load).
- [ ] A room code/link lets a second player join the creator's exact game.
- [ ] Killing one client's network and restoring it within grace resumes the same game with correct state; exceeding grace forfeits.
- [ ] At no point does a client receive un-revealed opponent ship positions (verify via network inspection).

### 7.5 Registration & guest accounts — *Req 5* (P0)

Powered by **better-auth**.
- **Guest / anonymous** session on first visit (better-auth anonymous plugin) so play works with zero signup; guest progress (streak, unrated stats, current game) tracked against the guest id.
- **Email + password** registration ("only e-mail and password, no spam" — mirror the reference's light-touch promise). Email verification (P1 — can allow immediate play, verify async).
- **Guest → account claim:** when a guest registers, migrate their guest id's data (assign guest's history/streak to the new user; guests are unrated so no rating merge conflict). Handle the "already have an account" path by logging in and discarding the throwaway guest.
- Password reset via email (P1). OAuth (Google/etc.) is P2.
- Minimal profile: display name, avatar (generated from a seed, e.g. boring-avatars/DiceBear), optional country flag for the leaderboard.

**GDPR (you're EU-based, so bake this in from day one):**
- Cookie/consent handling; privacy policy + terms pages.
- Data export and account deletion (right to erasure) — even if manual/ticketed at MVP, expose the path.
- Store only what's needed (email, hashed password, game data); no third-party ad trackers.

**Acceptance criteria**
- [ ] A brand-new visitor can play a full bot game without registering.
- [ ] Registering as a guest preserves that guest's streak and history under the new account.
- [ ] Rated quick-match requires a registered account; guests are routed to unrated play with a clear upsell.

### 7.6 Rating system — Glicko-1 — *Req 6* (P0)

Implement **Glicko-1** (Glickman) server-side. Each player has a **rating** (default 1500) and a **rating deviation RD** (default 350, representing uncertainty). New/inactive players have high RD (their rating moves fast); active players have low RD (stable).

**Mechanics to implement (per Glickman's Glicko-1 paper):**
- Constant `q = ln(10)/400`.
- `g(RD) = 1 / sqrt(1 + 3·q²·RD² / π²)`.
- Expected score `E = 1 / (1 + 10^(−g(RD_opp)·(r − r_opp)/400))`.
- `d² = 1 / (q² · g(RD_opp)² · E · (1 − E))`.
- New rating `r' = r + (q / (1/RD² + 1/d²)) · g(RD_opp) · (s − E)` where `s ∈ {1, 0.5, 0}`.
- New deviation `RD' = sqrt(1 / (1/RD² + 1/d²))`.
- **RD growth over inactivity** between rating periods: `RD ← min(sqrt(RD² + c²·t), 350)` where `t` = elapsed rating periods and `c` is tuned so an unrated-length inactivity returns RD to ~350 over a chosen span.

**Rating period design.** Glicko-1 is defined over rating periods (batch of games), but a live ladder wants near-instant updates. Two acceptable approaches — pick one:
- **Per-game update** (treat each game as its own mini-period): simplest, immediate feedback, slight theoretical deviation from batch-Glicko. Common in practice for live ladders.
- **Short rating periods** (e.g. hourly/daily batch): more faithful, but delayed rating movement. **Recommendation: per-game update** for UX, with the RD-inflation-on-inactivity applied lazily at the next game based on elapsed time. (Note: if you later want the more rigorous per-period volatility handling, that's **Glicko-2** — schema already reserves a volatility column.)

- Only **rated** games update ratings. Forfeits/disconnects/timeouts count as a loss for the leaver, a win for the opponent, rated normally.
- Show the player their rating delta at game end (animated in §7.1).

**Acceptance criteria**
- [ ] A new player starts at 1500/RD 350; RD shrinks as they play.
- [ ] Beating a much higher-rated opponent yields a larger gain than beating a peer; losing to a lower-rated opponent costs more.
- [ ] Unrated games (bot, guest, private-unrated) never change rating or RD.
- [ ] Rating math has unit tests against worked examples from the Glicko-1 paper.

### 7.7 Leaderboard — *Req 7* (P0)

- Global ranking by rating (with a **minimum games-played / max-RD threshold** so provisional players aren't shown at the top on noise). Sort by rating desc; tiebreak by RD asc then games.
- Columns: rank, avatar, display name, country flag (opt), rating, W/L, win-rate, streak/best.
- Views: **Top N**, **around me** (my rank ± a few), filters by mode (Classic/Salvo) if you rate them separately (Open Question OQ-1). Optional weekly/monthly boards (P1).
- Reads served from a cached snapshot (`leaderboard_snapshots` refreshed on a cron, or `ratings(rating desc)` index for live small scale). Cache read responses in Upstash.

**Acceptance criteria**
- [ ] Leaderboard reflects rating changes within the defined freshness window.
- [ ] Provisional (high-RD / too-few-games) players are excluded from the top ranking but can see their own "around me" position.
- [ ] Loads fast at scale via cache/snapshot, not a full table scan per request.

### 7.8 Tournaments — *Req 8* (P1; single-elim MVP)

**v1 scope: scheduled single-elimination.**
- Organizer creates a tournament: name, mode, rated?, max players (power of two or auto-bye padding), registration window, start time.
- Registration: players join during the window; lock at start; **seed by rating** (or random).
- Bracket: auto-generate single-elim bracket with byes for non-power-of-two fields; render an interactive bracket view.
- Round flow: at each round, auto-create the paired games (private-room-style sessions tied to `tournament_matches`); winners advance automatically; handle no-shows via a forfeit timer.
- Completion: crown a winner, award a badge; optionally apply rating (if `rated`).
- Notifications: in-app "your match is ready" (email is P2).

**P2 tournament ideas:** Swiss and round-robin formats; best-of-N matches; recurring/auto-scheduled tournaments; prize/points ladders.

**Acceptance criteria**
- [ ] An organizer can create, open registration, start, and complete a single-elim tournament with a non-power-of-two field (byes handled).
- [ ] Winners advance automatically; a no-show is resolved by forfeit within the timeout.
- [ ] The bracket view is legible on mobile and desktop.

### 7.9 Onboarding: FAQ / video / slides — *Req 9* (P0 for FAQ+rules; P1 for video)

- **How-to-play** section mirroring the reference's three steps (place fleet → fire in turns, hit=go again → sink the whole fleet), expanded with the no-touching rule and Salvo explanation.
- **Interactive tutorial** (P1): a scripted first game vs an easy bot with contextual hints ("drag to place", "tap to fire") — higher retention than static slides.
- **Slides/carousel** explaining rules and modes (shadcn carousel); assets on R2.
- **Video** (P1): short gameplay explainer. Host on an external video platform (YouTube/Vimeo embed) or R2 + a player — **don't** build video infra. Provide captions.
- **FAQ** (accordion): registration optional?, how to play a friend?, bot?, mobile?, is it free?, how rating works?, how to delete my account? (GDPR). Seed from the reference's FAQ, expanded.

**Acceptance criteria**
- [ ] A first-time player can learn the full ruleset (including no-touching + Salvo) without leaving the site.
- [ ] FAQ and rules are reachable from the landing page and in-game help.

### 7.10 Responsive web design — *Req 10* (P0)

- Single responsive codebase; **no native app.** Mobile-browser-first.
- Desktop: two boards side-by-side + side panel (status, timer, reactions, chat-of-emojis). Mobile: board-focused, opponent/your-board via tab or vertical stack, sticky turn/timer bar, thumb-reachable fire controls.
- Handle `viewport-fit=cover` / safe areas (notches), landscape and portrait, and touch vs mouse (drag placement must work by touch).
- Test matrix: latest Chrome/Safari/Firefox on desktop; iOS Safari + Android Chrome; small (≤360px) to large (≥1440px) widths.
- PWA niceties (installable, offline shell for the marketing page) are P1.

**Acceptance criteria**
- [ ] The full game (place, fire, win) is completable on a 360px-wide phone browser and on a 1440px desktop with layouts that look intentional, not stretched.
- [ ] Ship placement works by touch drag on mobile.

### 7.11 Support / donate link — *Req 11* (P0)

- Prominent, honest "Support the project" CTA (mirror the reference: no ads, no paywalled features, donations keep servers running).
- **Outbound link only** to a payment provider — no in-app checkout, keeping you out of PCI scope. The reference used Cloudtips; for an EU/Austria context prefer **Stripe Payment Links**, **Ko-fi**, **Buy Me a Coffee**, or **PayPal.me** (choose per fees/availability — Open Question OQ-4).
- Place on landing page, footer, and a subtle post-game prompt (not nagging).

**Acceptance criteria**
- [ ] The donate button opens the provider in a new tab; no payment data is entered or stored in-app.
- [ ] Messaging clearly states the project is free with no paywalled features.

### 7.12 Badges & streaks (from reference; P1)

- **Daily streak:** increment on first play each day; track current + best; surface on profile and leaderboard.
- **Badges:** wins milestones, accuracy (hit-rate) thresholds, win streaks, tournament wins, "beat Hard bot", etc. Criteria in `badges.criteria_json`, evaluated server-side at game end.
- Show in profile; small toast on earning.

### 7.13 Cosmetics — monetization & personalization (P2 earn-only; P3 paid store)

Cosmetics are the **primary revenue path that respects the competitive core**: players buy identity and flourish, never advantage. This section is the load-bearing "how" behind that promise.

**The hard constraint — cosmetics are render-only and information-neutral.** This is a rated game with a server-authoritative trust model (§10), and cosmetics must not weaken it:
- Cosmetics live **entirely in the client render layer**. The authoritative game session (DO/room) is **cosmetics-agnostic** — it never reads, stores, or transmits cosmetic state, so cosmetics can't touch game logic, RNG, timers, or results.
- A cosmetic may **only change appearance, never information**. No theme may reveal ship outlines early, make the opponent's un-revealed cells inferable, or alter the legibility of hit/miss/sink relative to the base. Every cosmetic renders the *same information* as the default skin.
- All cosmetics **preserve the accessibility guarantees** from §7.1: colorblind-safe hit/miss encoding (shape + color, never color alone) and `prefers-reduced-motion` fallback to instant, non-flashing states. An effect pack that can't honor reduced-motion must ship a reduced-motion variant or it doesn't ship.
- Cosmetics respect the **60fps mobile performance budget**; heavy effect packs are optimized/gated, not shipped as-is.
- **Pay-to-win is an explicit Non-Goal** (see §2). No cosmetic or paid item grants extra time, undos, board reveals, rating protection, or matchmaking advantage. Written here as a hard product boundary, not a guideline.

**Categories.**
- **Board themes** — grid style, water texture/animation, palette (constrained to preserve hit/miss encoding).
- **Ship skins** — visual style of ships during placement and when revealed/sunk.
- **Effect packs** — fire / splash (miss) / hit / sink animation sets.
- **Victory & defeat sequences** — the end-of-game flourish.
- **Avatar frames** — border/flair around the profile avatar.
- **Emoji reaction packs** — expanded sets beyond the free base reactions.
- **Name flair** — animated name color / small inline badge on leaderboard and in-game.

**Acquisition (sequenced — build earn-only first, add paid later).**
- **Starter** — a small free set every player (incl. guests) can equip, so the system feels alive pre-purchase.
- **Earned** — unlocked via badges, streak milestones, "beat Hard bot", XP/level, etc. Ties directly into §7.12; this is the Phase 2 scope and needs **no payment infrastructure**.
- **Tournament rewards** — exclusive items for placement (§7.8), a strong status driver.
- **Supporter reward** — donors (§7.11) receive an exclusive cosmetic. Turns the donate link into a tangible, non-pay-to-win thank-you without becoming a paywall.
- **Purchase** — direct real-money buy from the store. **Phase 3**, because it escalates scope: it requires real checkout (see "Payments" below) — a deliberate step beyond the MVP's "donate link only" (§2 Non-Goal).
- *(Optional, OQ-8)* **Soft currency** earned by playing and spent on cosmetics — a classic engagement loop, but it adds economy-balancing burden; deferred/optional.

**Rendering architecture.**
- Each cosmetic resolves to a **manifest** (`cosmetic_items.manifest_json`): a set of render tokens (CSS variables / theme config) and asset refs (R2 URLs for sprites, sounds, Lottie/Framer effect definitions). The board and chrome consume tokens, so **new items are data-driven** — add a catalog row + assets, ideally no code deploy.
- The client fetches **its own loadout** (authenticated) and the **opponent's public loadout** (public read — equipped cosmetics are public info) via REST at game start, **not** through the authoritative game socket. This keeps cosmetics off the anti-cheat-critical path.
- **Preload** equipped assets before the game starts to avoid pop-in; assets edge-cached from R2.
- **Guests** may equip the starter set; owned/earned/purchased items require an account (durable identity). Earned unlocks carry over on guest→account claim (§7.5).

**Store & Locker UI.**
- **Locker (inventory):** owned items grouped by category; equip/unequip; one equipped slot per category (`user_loadout`). Equipping is **server-validated against ownership** — you can't equip what you don't own.
- **Store:** browse catalog with **live in-context preview** (render the item on a sample board / avatar before acquiring); rarity and acquisition method shown; earned items show their unlock condition, purchasable items show price.
- Post-game and profile surfaces nudge toward the store/locker without nagging.

**Payments (Phase 3 only — deliberate scope escalation).**
- Use a **hosted checkout** (Stripe Checkout / Payment Links) so no card data touches your servers (stays PCI-lite, consistent with §2). Entitlements granted by **webhook**, keyed on `purchases.provider_ref` for **idempotent, exactly-once** grants (a duplicated/replayed webhook must not double-grant).
- **EU/Austria VAT flag:** selling digital goods to EU consumers triggers **VAT-on-digital-services** obligations and likely **OSS registration** — a real accounting/legal step, not a code toggle. Keep cosmetics **earn-only until you're ready to handle this** (Open Question OQ-9). This is why earned-first is the recommended sequence.

**Acceptance criteria**
- [ ] Equipping an item the user does not own is rejected server-side.
- [ ] The opponent's equipped cosmetics render for you, sourced from a **public read**, never from the authoritative game channel, and never alter game state, RNG, timers, results, or information visibility.
- [ ] Every cosmetic preserves colorblind-safe hit/miss encoding and honors `prefers-reduced-motion`; no cosmetic reveals un-revealed opponent cells or ship outlines early.
- [ ] Guests can equip starter cosmetics; earned unlocks survive guest→account conversion.
- [ ] No cosmetic or purchase confers any competitive advantage (verified against the Non-Goal).
- [ ] *(Phase 3)* A completed purchase grants the entitlement via webhook exactly once; a duplicate/failed webhook neither double-grants nor grants on failure.

### 7.14 Internationalization & Localization (i18n) — *5 locales* (P0 architecture; DE launch-priority, ES/IT/FR as translated)

The UI and all player-facing content ship in **English (en), German (de), Spanish (es), Italian (it), French (fr)**. **No Russian.** English is the source/fallback locale; German is a launch priority given the Austrian home market.

**Architecture — externalize from day one.** i18n is a P0 *architectural* requirement even though full translations land progressively: retrofitting hardcoded strings later is expensive, so **no user-facing string is hardcoded** from the first commit. Recommended: **`next-intl`** (built for the Next.js 15 App Router; server-component-friendly, ICU MessageFormat support). `next-i18next` is the alternative if you prefer that ecosystem.

**Locale routing & detection.**
- Path-based locale segment: `/[locale]/...` (e.g. `/de/play`, `/es/leaderboard`), via App Router + middleware.
- Detection order: explicit user choice (persisted) → `users.locale` (registered) → locale cookie (guests) → `Accept-Language` header → default `en`.
- A visible **language switcher** (in header/footer and settings) sets the cookie and, for registered users, writes `users.locale`. Guest choice carries over on account claim (§7.5).
- Emit correct `<html lang>` per locale (accessibility + SEO).

**What must be translated (scope of "UI and related content").**
- **Static UI chrome** — every label, button, menu, tooltip, empty state, toast, and error/validation message. Message catalogs (JSON) per locale, namespaced by feature.
- **Onboarding & help** — how-to-play, FAQ, rules, tutorial hints, and **slide decks** (§7.9); **video subtitles/captions** per locale (host provides multi-track captions).
- **Transactional emails** — verification, password reset, tournament "your match is ready," etc., rendered in the recipient's `users.locale`.
- **DB-stored catalog content** — badge and cosmetic `name`/`description` are localized in-row via JSONB `*_i18n` maps (§6), EN required, others fall back to EN when missing.
- **SEO/meta** — localized `<title>`, meta description, and Open Graph per route; `hreflang` alternates across all five locales; per-locale sitemap entries.
- **Legal pages** — privacy policy & terms need locale versions; **German/Austrian legal review** matters for GDPR/consumer-law wording (flag, not a pure translation task — OQ-12).

**What is NOT translated.** User-generated values: display names, organizer-chosen tournament names, avatar seeds. Emoji reactions are locale-agnostic (a bonus of having no free-text chat — no UGC translation/moderation burden).

**Formatting & correctness (not just string swaps).**
- Use **ICU MessageFormat** for **pluralization and gender/number agreement** — e.g. "1 ship remaining" vs "3 ships remaining" differ per language and must not be string-concatenated. This matters for game copy ("X shots," "Y players," countdowns).
- Locale-aware **dates, relative times, and numbers** via `Intl.*` (rating, W/L, "2 minutes ago," tournament times in the viewer's locale/timezone).
- **Text expansion:** German (and often French) runs ~20–35% longer than English. The UI (§7.1, §7.10) must flex — no fixed-width labels/buttons, no truncation of critical copy — and layouts are tested in `de` specifically, not just `en`.

**Translation workflow.** EN is the single source of truth. Keep keys stable and namespaced; treat catalogs as reviewable artifacts. Machine-translate DE/ES/IT/FR then have a human review (at minimum DE, given the home market) before marking a locale "complete." A TMS (e.g. Crowdin/Locize) is a P1 convenience, not required to start. A locale can be **partially translated and still shipped** because missing keys fall back to EN — so English ships first, the other four fill in without blocking release.

**Acceptance criteria**
- [ ] No user-facing string is hardcoded; all resolve through the i18n layer (lint/CI check for literal JSX text is a plus).
- [ ] Switching language updates the entire UI, persists (cookie for guests, `users.locale` for accounts), and survives reload and guest→account conversion.
- [ ] Plurals and number/date formatting are correct per locale (verified for `de`, `fr` plural rules, not just `en`).
- [ ] Emails render in the recipient's locale; badge/cosmetic names show localized text with EN fallback for any missing key.
- [ ] `<html lang>`, `hreflang`, and localized meta are emitted per route; the `de` layout renders without overflow/truncation given longer strings.
- [ ] English is fully translated at launch; DE/ES/IT/FR can be incomplete and safely fall back to EN.

---

## 8. Design System & Visual Direction

- **Tailwind + shadcn/ui** for all chrome (dialogs, tabs, accordion, carousel, toasts, forms). Board is custom (SVG/canvas), not shadcn.
- Dark-first slate palette with one or two accent colors (naval blue + a warm hit/flame accent). Define design tokens (colors, spacing, radii, motion durations) once.
- **Framer Motion** for board and transition animation; consistent easing/duration tokens; global reduced-motion honoring.
- Typography: one modern sans (e.g. Inter/Geist) + optional display face for the logo/headers.
- Iconography: lucide (ships stylized in SVG).
- **i18n-aware layout:** design for text expansion (DE/FR strings run longer than EN) — flexible widths, wrapping, no truncation of critical copy; test layouts in `de` (§7.14).
- Follow the frontend-design skill's guidance to avoid a templated look — intentional spacing, a distinctive board treatment, and cohesive motion are what make it feel "high quality."

---

## 9. Real-time Protocol (client ⇄ session)

Transport: WebSocket to the game session (DO/PartyKit) or Ably/Pusher channel + REST in the fallback design. All messages authenticated by the session token; server ignores/rejects intents that violate turn/ownership rules.

**Client → server intents**
- `join { gameId, token }`
- `place_fleet { placements[] }` (proposed; server validates no-touching, bounds, fleet composition)
- `ready` (confirm placement)
- `fire { cells[] }` (1 cell Classic; N cells Salvo)
- `react { emoji }`
- `resign`
- `heartbeat`

**Server → client events** (filtered per recipient — never leak the opponent's un-revealed cells)
- `state_snapshot { yourBoard, opponentRevealed, turn, phase, timers, scores }`
- `game_start { mode, ruleset, opponent{name,rating,rd?} }`
- `placement_accepted` / `placement_rejected { reason }`
- `turn_changed { activePlayer, deadlineTs }`
- `fire_result { cells: [{coord, outcome: hit|miss|sunk, shipOutline?}], extraTurn? }`
- `ship_sunk { outline, bufferCells }`
- `opponent_reacted { emoji }`
- `opponent_disconnected { graceDeadlineTs }` / `opponent_reconnected`
- `game_over { winner, reason, ratingDelta?, newRating?, badgesEarned[] }`
- `error { code, message }`

Server authority rules: reject fire when not your turn / wrong phase / duplicate cell / out of bounds / wrong salvo size; clamp/validate every field; server owns all timers and RNG.

---

## 10. Anti-Cheat & Fairness

- **Server-authoritative** everything (state, results, RNG, timers, rating). Client is a renderer.
- **Hidden-information filtering:** opponent board never serialized to a client until legitimately revealed. Verified as an explicit test.
- **Input validation & rate limiting** on all intents (Upstash rate limiter) to stop spam/DoS and scripted fire-floods.
- **Idempotency / sequencing** on moves so a replayed/duplicated message can't double-fire.
- **Abandonment handling** so disconnect-to-avoid-loss is a loss.
- **Optional commit–reveal placement** (P2) for provable fairness claims.
- **Matchmaking abuse:** discourage smurf/boost by rating-gated matching + high initial RD; monitor for collusion patterns in tournaments (P2).

---

## 11. Non-Functional Requirements

- **Performance:** landing LCP fast (mostly static, edge-cached); in-game action→feedback perceived latency low (optimistic local echo for *your* shot animation, reconciled to authoritative result). Board renders at 60fps on mid-range mobile.
- **Availability:** game sessions resilient to a single client disconnect (grace + resume). Graceful degradation if realtime layer hiccups (show reconnecting state).
- **Security:** HTTPS everywhere, secure/signed session cookies, CSRF protection on state-changing REST, secrets in env, least-privilege DB creds, RLS on Postgres where multi-tenant-ish patterns apply.
- **Privacy/GDPR (EU):** consent, privacy policy, data export + erasure path, minimal PII, no ad trackers, EU data residency preference (Neon EU region, R2, EU-hosted analytics like self-host/EU PostHog).
- **Cost:** idle-cheap (serverless + DO/room-per-active-game only while games are live); cache leaderboard; avoid always-on servers.
- **Observability:** structured logs from session layer, error tracking (Sentry), product analytics (PostHog) for funnel (land → first shot → register → rated game → return).
- **Testing:** unit tests for rules engine, Glicko math, bot logic; integration tests for matchmaking atomicity and the "no board leak" invariant; E2E (Playwright) for the full play loop on mobile+desktop viewports.

---

## 12. Analytics & Success Metrics

**Leading indicators (days–weeks)**
- **Time-to-first-shot** for new visitors (target: median < 10s).
- **Guest→registration conversion** (target: set after baseline; e.g. 15–25% of returning guests).
- **Quick-match fill time** at concurrency (target: median < 30s).
- **Game completion rate** (started → finished, not abandoned).
- **D1/D7 return rate.**

**Lagging indicators (weeks–months)**
- Rated-game share of total games; leaderboard participation.
- Tournament participation and completion.
- Donations (count, not revenue-critical).
- Rating distribution health (is the ladder well-spread, not degenerate).

Define exact targets after a baseline week (Open Question OQ-5).

---

## 13. Phasing / Roadmap

**Phase 0 — Playable core (single spec for Claude Code handoff)**
- Board UI + placement + fire + rules engine (Classic), sound + mute, vs-bot (all 3 levels), responsive layout, landing + how-to + FAQ, donate link, guest sessions, **i18n architecture wired from the start** (next-intl, locale routing, ICU, all strings externalized) with **English complete + German** as the launch pair.

**Phase 1 — Live & rated**
- Realtime session layer (DO/PartyKit), quick-match + private-room, reconnection, emoji reactions, better-auth email accounts + guest claim, Glicko-1 + rating deltas, leaderboard, **Spanish/Italian/French catalogs filled in** (fall back to EN until complete), localized transactional emails.

**Phase 2 — Depth**
- Salvo mode, badges + streaks, single-elim tournaments, interactive tutorial + video (**localized captions/slides**), weekly leaderboards, GDPR export/erasure UI, **cosmetics system earn-only** (catalog + locker/equip + earned/tournament/supporter unlocks + starter set — no payment infra).

**Phase 3 — Polish/scale**
- Swiss/best-of tournaments, seasons, OAuth login, commit–reveal, PWA, richer stats/replays, **cosmetics paid store** (hosted checkout + webhook entitlements + EU VAT/OSS handling), optional soft currency.

(Consistent with your usual pattern: I can split each phase into its own implementation-ready markdown for Claude Code.)

---

## 14. Open Questions

- **OQ-1 (design/product):** Are Classic and Salvo **separately rated** (two Glicko ratings + two leaderboards) or one combined rating? Separate is cleaner competitively but splits the population.
- **OQ-2 (engineering):** Session layer — commit to **Cloudflare Durable Objects / PartyKit** (recommended), or ship the **Upstash Redis + Ably/Pusher** fallback first for speed? Affects timers and reconnection design.
- **OQ-3 (product):** Timeout policy in Salvo — auto-fire random valid cells, or forfeit after K expiries? Tune for fairness vs anti-stall.
- **OQ-4 (you):** Donation provider for EU/Austria — Stripe Payment Link vs Ko-fi vs BMAC vs PayPal (fees, payout, ease). Just a link, so easy to change.
- **OQ-5 (data):** Concrete numeric targets for the success metrics after a baseline week.
- **OQ-6 (product):** Guest live PvP — allow guests into unrated quick-match, or require registration for any live game to cut abandonment/abuse? (Reference allows instant play; live-vs-stranger for pure guests raises abuse questions.)
- **OQ-7 (legal):** Terms/privacy authoring and cookie-consent tooling choice for GDPR.
- **OQ-8 (product):** Cosmetics economy — permanent catalog only, or add **rotating/limited-time** items and/or a **soft earn-by-play currency**? Currency drives engagement but adds balancing/economy burden.
- **OQ-9 (you/legal):** When (if ever) to introduce **paid** cosmetics — the trigger is readiness to handle **EU digital-goods VAT / OSS registration** and hosted checkout. Earn-only avoids this entirely; recommended until there's an audience worth monetizing.
- **OQ-10 (product):** Show opponents' equipped cosmetics **mid-game**, or only on profile/post-game? Some competitive games hide opponent flair during play to reduce distraction/tilt.
- **OQ-11 (product/ops):** Translation approach for DE/ES/IT/FR — professional translators, machine + human review, or community/TMS (Crowdin/Locize)? At minimum, human-review German before marking it complete.
- **OQ-12 (legal):** Privacy policy & terms need locale versions with **German/Austrian legal review** (GDPR + EU consumer law), not just translation — who authors/reviews these?

---

## 15. MVP Definition of Done (Phase 0 + core of Phase 1)

- [ ] Guest can land and complete a Classic game vs each bot level, with sound (and working mute), on both a 360px phone browser and desktop.
- [ ] Placement enforces the full ruleset (fleet composition, bounds, no-touching) server-side.
- [ ] Two players quick-match into a **rated** Classic game; results update Glicko-1 correctly and appear on the leaderboard.
- [ ] Private room by code/link works; reconnection within grace resumes; beyond grace forfeits.
- [ ] Opponent's un-revealed board is never sent to the client (verified).
- [ ] Registration works; a guest converting to an account keeps their history/streak.
- [ ] How-to-play, FAQ, and a donate link are live.
- [ ] No user-facing string is hardcoded; the app runs through the i18n layer with **English and German** complete and a working language switcher (ES/IT/FR fall back to EN).
- [ ] Rating math and rules engine covered by unit tests; the play loop covered by an E2E test on mobile + desktop viewports.

---

*End of spec v0.3.*
