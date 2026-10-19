import { expect, test, type Page } from '@playwright/test';

/**
 * Choosing a language, and having that choice stick (spec §7.14).
 *
 * Guests keep their choice in a cookie; a registered player's choice is saved
 * against the account, so it follows them to another device. Both paths are here,
 * along with the fallback that lets a partly translated language ship at all.
 */
const PASSWORD = 'a-good-enough-password';

function unique(): { name: string; email: string } {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { name: `Lang_${tag}`.slice(0, 20), email: `lang_${tag}@example.test` };
}

async function chooseLanguage(page: Page, label: string): Promise<void> {
  await page
    .getByRole('combobox', { name: /change language|sprache ändern|cambiar idioma/i })
    .selectOption({ label });
}

async function register(page: Page, who: { name: string; email: string }): Promise<void> {
  await page.goto('/en/account');
  await page.getByRole('tab', { name: /create account/i }).click();
  await page.getByLabel(/display name/i).fill(who.name);
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 30_000 });
}

test('all five languages are offered, and switching changes the whole page @core', async ({
  page,
}) => {
  await page.goto('/en');

  for (const label of ['English', 'Deutsch', 'Español', 'Italiano', 'Français']) {
    await expect(page.getByRole('option', { name: label })).toHaveCount(1);
  }

  await chooseLanguage(page, 'Español');

  await expect(page).toHaveURL(/\/es$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('link', { name: 'Clasificación' })).toBeVisible();
});

test("a guest's choice survives a reload @core", async ({ page }) => {
  await page.goto('/en');
  await chooseLanguage(page, 'Italiano');
  await expect(page).toHaveURL(/\/it$/, { timeout: 20_000 });

  // The cookie is what carries a guest's choice, so the bare root must honour it.
  await page.goto('/');
  await expect(page).toHaveURL(/\/it$/, { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'it');
});

test('the translated pages read as that language, not as raw keys @core', async ({ page }) => {
  for (const [path, heading] of [
    ['/fr/leaderboard', 'Classement'],
    ['/es/how-to-play', 'Cómo jugar'],
    ['/it/faq', 'Domande frequenti'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();

    const body = (await page.locator('body').innerText()).toUpperCase();
    expect(body, path).not.toMatch(/NAV\.|ACCOUNT\.|LEADERBOARD\.|HOWTOPLAY\.|FAQ\./);
  }
});

test("a registered player's language follows them to another device @core", async ({ browser }) => {
  const who = unique();

  // First device: register, then choose French.
  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await register(firstPage, who);

  /**
   * The save is deliberately fire-and-forget — switching language must not wait on
   * it — so the test waits for it instead. Closing the browser the instant the URL
   * changes would race the request that makes the next device work.
   */
  const saved = firstPage.waitForResponse(
    (response) => response.url().includes('/api/account/locale') && response.ok(),
    { timeout: 30_000 },
  );
  await chooseLanguage(firstPage, 'Français');
  await expect(firstPage).toHaveURL(/\/fr\//, { timeout: 20_000 });
  await saved;
  await first.close();

  // Second device: a fresh browser with no cookie of its own, signing in.
  const second = await browser.newContext();
  const page = await second.newPage();
  await page.goto('/en/account');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  await expect(page).toHaveURL(/\/fr\/play$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

  await second.close();
});

test('signing in does not override a language the account never chose', async ({ browser }) => {
  const who = unique();

  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await register(firstPage, who);
  await first.close();

  // This account has no stored preference, so the browser's own choice stands.
  const second = await browser.newContext();
  const page = await second.newPage();
  await page.goto('/de/account');
  await page.getByLabel(/E-Mail/i).fill(who.email);
  await page.getByLabel(/Passwort/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^anmelden$/i }).click();

  await expect(page).toHaveURL(/\/de\/play$/, { timeout: 30_000 });

  await second.close();
});
