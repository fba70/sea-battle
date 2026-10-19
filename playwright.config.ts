import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright does not read .env.local the way Next does, but the guest-session
 * specs gate on DATABASE_URL. Without this the DB-backed tests would silently
 * skip even on a fully configured machine.
 */
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Absent is fine — the specs then skip with an explicit reason.
  }
}

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

/**
 * Playwright ships a frozen WebKit build for macOS 14 that crashes on launch
 * (`Bus error: 10`). Set PLAYWRIGHT_SKIP_WEBKIT=1 to run the rest of the matrix
 * on such a machine. CI and any newer macOS should leave it unset so Safari and
 * iOS Safari are genuinely exercised (spec §7.10).
 */
const skipWebkit = process.env.PLAYWRIGHT_SKIP_WEBKIT === '1';

const CORE_ONLY = /@core/;

/**
 * Tests that compete for the one global matchmaking queue.
 *
 * Quick match pairs whoever is waiting, which is the product working correctly and
 * a disaster for test isolation: two projects running the same spec put four guests
 * in one pool, and they pair across tests. These run in a single project, so the
 * only players searching at any moment are the ones a test put there.
 */
const QUEUE_BOUND = /@queue/;

const webkitProjects = [
  {
    name: 'desktop-webkit',
    use: { ...devices['Desktop Safari'] },
    grep: CORE_ONLY,
    grepInvert: QUEUE_BOUND,
  },
  {
    name: 'mobile-safari',
    use: { ...devices['iPhone 14'] },
    grep: CORE_ONLY,
    grepInvert: QUEUE_BOUND,
  },
];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  /**
   * Spec §7.10 test matrix: "latest Chrome/Safari/Firefox on desktop; iOS Safari
   * + Android Chrome".
   *
   * Chromium runs the whole suite. The other engines run the `@core` subset —
   * the flows whose behaviour actually differs between engines: pointer-drag and
   * click placement, keyboard play, the full match, the accordion, autoplay and
   * storage, and locale routing. Re-running content assertions in five engines
   * would add runtime without adding signal.
   */
  projects: [
    // The only project that runs the queue-bound specs.
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] }, grepInvert: QUEUE_BOUND },
    {
      name: 'desktop-firefox',
      use: { ...devices['Desktop Firefox'] },
      grep: CORE_ONLY,
      grepInvert: QUEUE_BOUND,
    },
    ...(skipWebkit ? [] : webkitProjects),
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
