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
              ],
              message:
                'src/game must stay framework- and transport-independent. Keep it pure; wire it up from src/server or src/app instead.',
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
