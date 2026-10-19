import { expect, test } from '@playwright/test';

/**
 * Foundation smoke test. This is the harness the full play-loop E2E (spec §15)
 * will grow into — it already runs on both a desktop and a mobile viewport.
 */
test('redirects the bare root to the default locale', { tag: '@core' }, async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('serves German content with the correct lang attribute', async ({ page }) => {
  await page.goto('/de');

  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Versenke die Flotte.');
});

test('renders a fully translated locale end to end', async ({ page }) => {
  /**
   * French used to be a stub, and this test proved the English fallback by
   * reading English text off a French page. All five catalogs are complete now,
   * so it asserts the opposite: nothing English is left showing. The fallback
   * itself is covered by src/i18n/messages.test.ts against a deliberately
   * incomplete catalog, which is what a newly added key actually looks like.
   */
  await page.goto('/fr');

  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Coulez la flotte.');
  await expect(page.getByText('Grille 10 x 10, dix navires')).toBeVisible();
  await expect(page.getByText('10 x 10 board, ten ships')).toHaveCount(0);
});

test('language switcher moves between locales', { tag: '@core' }, async ({ page }) => {
  await page.goto('/en');

  await page.getByLabel('Change language').selectOption('de');

  await expect(page).toHaveURL(/\/de$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});
