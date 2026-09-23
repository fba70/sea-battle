/// <reference types="@cloudflare/workers-types" />
import type { GameRoom } from './game-room';

export interface Env {
  /** One Durable Object per live game (spec §5.1). SQLite-backed — see wrangler.jsonc. */
  readonly GAME_ROOM: DurableObjectNamespace<GameRoom>;
  /** Shared with the Next app, which mints connection tickets (spec §5.2). */
  readonly GAME_TICKET_SECRET: string;
  /**
   * Where finished matches are reported (spec §5.1). The realtime layer deliberately
   * has no database binding — the Next app owns Neon and does the writing.
   */
  readonly GAME_RESULT_URL?: string;
}
