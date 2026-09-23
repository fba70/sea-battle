import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // e2e/ is Playwright's; keep the two runners from fighting over the same files.
    // *.worker.test.ts needs the Workers runtime — see vitest.workers.config.ts.
    exclude: ['node_modules/**', '.next/**', 'e2e/**', 'src/worker/**/*.worker.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
