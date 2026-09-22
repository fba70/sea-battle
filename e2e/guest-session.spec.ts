import { expect, test, type Page } from '@playwright/test';

const hasDatabase = Boolean(process.env.DATABASE_URL);

interface SessionUser {
  id: string;
  isAnonymous?: boolean;
}

async function readSession(page: Page): Promise<SessionUser | null> {
  const response = await page.request.get('/api/auth/get-session');
  if (!response.ok()) return null;
  const body = (await response.json().catch(() => null)) as { user?: SessionUser } | null;
  return body?.user ?? null;
}

/** Waits for the provider to establish the guest session after hydration. */
async function waitForGuest(page: Page): Promise<SessionUser> {
  await expect
    .poll(async () => (await readSession(page))?.id ?? null, { timeout: 20_000 })
    .not.toBeNull();

  const user = await readSession(page);
  if (!user) throw new Error('guest session vanished immediately after being created');
  return user;
}

/**
 * Spec §7.5 / §13 Phase 0: a guest identity so "a brand-new visitor can play a
 * full bot game without registering", created when a game is entered rather
 * than on any page view (§11 cost + minimal-PII).
 */
test.describe('guest session against the real database', () => {
  test.skip(
    !hasDatabase,
    'needs DATABASE_URL (a Neon connection string) in .env.local to reach the auth store',
  );

  test('entering a bot game creates an anonymous guest identity', async ({ page }) => {
    await page.goto('/en/play/bot');
    const guest = await waitForGuest(page);

    expect(guest.id).toBeTruthy();
    expect(guest.isAnonymous).toBe(true);
  });

  test.describe('public content pages create no guest', () => {
    for (const route of ['/en', '/en/faq', '/en/how-to-play', '/de']) {
      test(`visiting ${route} leaves the visitor anonymous-free`, async ({ page }) => {
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        // Generous settle: the provider, if it were mounted, would have fired
        // well within this window (proven by the game-route test above).
        await page.waitForTimeout(1500);

        expect(await readSession(page)).toBeNull();
      });
    }
  });

  test('reading the FAQ then entering a game creates exactly one identity', async ({ page }) => {
    await page.goto('/en/faq');
    await page.waitForTimeout(1000);
    expect(await readSession(page)).toBeNull();

    await page.goto('/en/play/bot');
    const guest = await waitForGuest(page);
    expect(guest.isAnonymous).toBe(true);
  });

  test('the session survives a reload and keeps the same identity', async ({ page }) => {
    await page.goto('/en/play/bot');
    const before = await waitForGuest(page);

    await page.reload();
    const after = await waitForGuest(page);

    expect(after.id).toBe(before.id);
    expect(after.isAnonymous).toBe(true);
  });

  test('an established guest is reused across content pages and locales', async ({ page }) => {
    await page.goto('/en/play/bot');
    const created = await waitForGuest(page);

    // A content page must not mint a second identity for someone who has one.
    await page.goto('/en/faq');
    expect((await readSession(page))?.id).toBe(created.id);

    await page.goto('/de/play/bot');
    const afterLocaleSwitch = await waitForGuest(page);
    expect(afterLocaleSwitch.id).toBe(created.id);
  });

  test('a separate visitor receives a different identity', async ({ browser }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();

    try {
      const firstPage = await first.newPage();
      await firstPage.goto('/en/play/bot');
      const firstGuest = await waitForGuest(firstPage);

      const secondPage = await second.newPage();
      await secondPage.goto('/en/play/bot');
      const secondGuest = await waitForGuest(secondPage);

      expect(firstGuest.id).toBeTruthy();
      expect(secondGuest.id).toBeTruthy();
      expect(secondGuest.id).not.toBe(firstGuest.id);
    } finally {
      await first.close();
      await second.close();
    }
  });

  test('a guest plays a full turn without ever signing up', async ({ page }) => {
    await page.goto('/en/play/bot');
    const guest = await waitForGuest(page);

    await page.getByRole('button', { name: 'Auto-place' }).click();
    await page.getByRole('button', { name: 'Start the battle' }).click();

    const enemy = page.getByRole('grid', { name: /Enemy waters/i });
    await enemy.locator('[aria-label*="unexplored"]:not([disabled])').first().click();
    await expect(page.locator('ol li').first()).toContainText(/Hit|Miss|Sank/);

    // Still the same anonymous identity — nothing prompted a signup.
    const after = await readSession(page);
    expect(after?.id).toBe(guest.id);
    expect(after?.isAnonymous).toBe(true);
  });
});

/**
 * The Phase 0 bot match runs entirely in the browser, so it must not depend on
 * the auth store being reachable. This runs in every environment.
 */
test(
  'the game stays fully playable when the guest session cannot be created',
  { tag: '@core' },
  async ({ page }) => {
    const crashes: string[] = [];
    page.on('pageerror', (error) => crashes.push(error.message));

    await page.goto('/en/play/bot');
    await page.getByRole('button', { name: 'Auto-place' }).click();
    await page.getByRole('button', { name: 'Start the battle' }).click();

    const enemy = page.getByRole('grid', { name: /Enemy waters/i });
    await enemy.locator('[aria-label*="unexplored"]:not([disabled])').first().click();

    await expect(page.locator('ol li').first()).toContainText(/Hit|Miss|Sank/);
    expect(crashes).toEqual([]);
  },
);
