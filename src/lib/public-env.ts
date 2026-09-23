/**
 * Where the realtime Worker lives, as seen by the browser.
 *
 * Defaults to the local `wrangler dev` port so a fresh checkout works without any
 * extra configuration. Set NEXT_PUBLIC_GAME_WS_URL when the Worker runs elsewhere.
 */
export function gameWebSocketUrl(): string {
  return process.env.NEXT_PUBLIC_GAME_WS_URL ?? 'ws://localhost:8787';
}
