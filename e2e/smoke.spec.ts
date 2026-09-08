import { expect, test } from '@playwright/test';

/**
 * Foundation smoke test. This is the harness the full play-loop E2E (spec §15)
 * will grow into — it already runs on both a desktop and a mobile viewport.
 */
test('redirects the bare root to the default locale', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('serves German content with the correct lang attribute', async ({ page }) => {
  await page.goto('/de');

  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Versenke die Flotte.');
});

test('falls back to English for untranslated keys', async ({ page }) => {
  // fr has no landing.foundationNotice — it must render the English string, not crash.
  await page.goto('/fr');

  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Coulez la flotte.');
  await expect(
    page.getByText('Project foundation is in place. The board and rules engine land next.'),
  ).toBeVisible();
});

test('language switcher moves between locales', async ({ page }) => {
  await page.goto('/en');

  await page.getByLabel('Change language').selectOption('de');

  await expect(page).toHaveURL(/\/de$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});
