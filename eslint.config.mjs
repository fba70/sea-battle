import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'drizzle/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    // Trust-boundary guard (CLAUDE.md "Game Architecture and Security"):
    // the rules engine must stay framework- and transport-independent so it can be
    // reused unchanged by the Next app, the bot, and whichever session layer OQ-2 picks.
    files: ['src/game/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-dom',
                'next',
                'next/*',
                'next-intl',
                'next-intl/*',
                'server-only',
                'client-only',
                '@/app/*',
                '@/components/*',
                '@/lib/*',
                '@/server/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'better-auth',
                'better-auth/*',
                // The engine stays dependency-free, validation included: the state
                // codec hand-rolls its checks so nothing in src/game needs Zod.
                'zod',
                'zod/*',
              ],
              message:
                'src/game must stay framework- and transport-independent. Keep it pure; wire it up from src/server or src/app instead.',
            },
          ],
        },
      ],
    },
  },
  {
    // The authoritative session layer (spec §5.1) must stay transport-independent so
    // OQ-2 only ever costs us an adapter. It may use the rules engine and Zod; it may
    // not reach for a socket, a realtime provider, a database or the UI.
    files: ['src/server/session/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-dom',
                'next',
                'next/*',
                'next-intl',
                'next-intl/*',
                '@/app/*',
                '@/components/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'better-auth',
                'better-auth/*',
                '@neondatabase/*',
                '@upstash/*',
                'ably',
                'ably/*',
                'partykit',
                'partykit/*',
                'partysocket',
                'ws',
                'node:net',
                'node:http',
                'node:https',
              ],
              message:
                'src/server/session is the transport-independent referee. Put sockets, realtime providers and persistence in an adapter around it, not inside it.',
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
