import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs outside Next, so load .env.local / .env ourselves (Node >= 20.6).
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file absent — fall through to the ambient environment
  }
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
