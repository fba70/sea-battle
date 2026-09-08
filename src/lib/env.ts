import { z } from 'zod';

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Placeholders so `next build`, lint and tests run on a machine with no Neon
 * project and no secret yet. Never used in production: the parse below throws
 * instead of falling back when NODE_ENV === 'production'.
 */
const developmentFallbacks: ServerEnv = {
  DATABASE_URL:
    'postgresql://user:password@ep-placeholder-000000.eu-central-1.aws.neon.tech/seaduel?sslmode=require',
  BETTER_AUTH_SECRET: 'development-only-insecure-secret-please-replace-me',
  BETTER_AUTH_URL: 'http://localhost:3000',
};

/**
 * `next build` runs with NODE_ENV=production but must not require real secrets:
 * it only evaluates modules, it never serves a request. Missing values are fatal
 * at production *runtime* only.
 */
function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.SKIP_ENV_VALIDATION === 'true'
  );
}

function loadServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (parsed.success) {
    return parsed.data;
  }

  if (process.env.NODE_ENV === 'production' && !isBuildPhase()) {
    const issues = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid server environment:\n${issues.join('\n')}`);
  }

  console.warn(
    '[env] Falling back to development placeholders for: ' +
      parsed.error.issues.map((issue) => issue.path.join('.')).join(', ') +
      '. Copy .env.example to .env.local before using the database or auth.',
  );

  // Keep whatever the environment does define; fill only the gaps, then re-validate
  // so a malformed (rather than missing) value still fails loudly.
  const provided = Object.fromEntries(
    Object.keys(developmentFallbacks)
      .map((key) => [key, process.env[key]] as const)
      .filter(([, value]) => value !== undefined && value !== ''),
  );

  return serverEnvSchema.parse({ ...developmentFallbacks, ...provided });
}

export const serverEnv: ServerEnv = loadServerEnv();
