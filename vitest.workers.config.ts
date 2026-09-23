import { fileURLToPath } from 'node:url';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Runs the Durable Object tests inside real workerd via Miniflare — the same runtime
 * Cloudflare executes, locally and with no account, deployment or billing involved.
 *
 * The Durable Object is declared here rather than by pointing at wrangler.jsonc on
 * purpose: resolving the wrangler config also pulls in `.env.local`, which would hand
 * the test Worker the Neon URL and the better-auth secret — credentials the realtime
 * layer must never hold. Declaring the two bindings explicitly keeps the test Worker
 * to exactly what it needs. `wrangler.config.test.ts` guards the two files against
 * drifting apart.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/worker/index.ts',
      miniflare: {
        compatibilityDate: '2026-08-01',
        durableObjects: { GAME_ROOM: { className: 'GameRoom', useSQLite: true } },
        // Local-only test value. The real one is set with `wrangler secret put`.
        bindings: {
          GAME_TICKET_SECRET: 'local-test-ticket-secret-not-a-real-secret',
          GAME_RESULT_URL: 'https://next.test/api/game/result',
        },
        /**
         * Stands in for the Next app's result endpoint. Tests assert the *effect* of
         * a report (the room's `reported` flag) rather than counting calls, so this
         * only needs to decide success or failure — and it fails deliberately for a
         * game id containing `failreport`, which is how the retry path is exercised.
         */
        outboundService: async (request: Request) => {
          const body = await request.text();
          if (body.includes('failreport')) {
            return new Response('nope', { status: 500 });
          }
          return Response.json({ status: 'completed', rating: 'skipped' });
        },
      },
    }),
  ],
  test: {
    include: ['src/worker/**/*.worker.test.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
