/**
 * Applies pending Drizzle migrations to the configured Neon database.
 *
 * Why this exists instead of `drizzle-kit migrate`: drizzle-kit selects the
 * `@neondatabase/serverless` *WebSocket* driver, which cannot reach a Neon pooler
 * endpoint from a plain Node process. It does not fail loudly — it prints a warning,
 * applies nothing, and exits 0, which silently leaves the database behind the schema.
 * drizzle-orm's neon-http migrator speaks the same HTTP protocol the app already uses.
 *
 * Note: neon-http has no transactions, so statements apply one at a time. A migration
 * that fails halfway leaves the earlier statements applied and writes no journal row.
 * Keep migrations additive, and check the reported error before re-running.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // absent — fall through to the ambient environment
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local first.');
  process.exit(1);
}

await migrate(drizzle(neon(url)), { migrationsFolder: './drizzle' });
console.log('Migrations up to date.');
