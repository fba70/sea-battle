import { expect, test, type Page } from '@playwright/test';

const MUTE_KEY = 'seaduel:sound-muted';

async function storedMute(page: Page) {
  return page.evaluate((key) => window.localStorage.getItem(key), MUTE_KEY);
}

test('mute control is present, labelled and keyboard reachable', async ({ page }) => {
  await page.goto('/en/play/bot');

  const toggle = page.getByRole('button', { name: 'Mute sound' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('button', { name: 'Unmute sound' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('mute preference persists across a reload', { tag: '@core' }, async ({ page }) => {
  await page.goto('/en/play/bot');
  await page.getByRole('button', { name: 'Mute sound' }).click();

  expect(await storedMute(page)).toBe('true');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Unmute sound' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // ...and unmuting persists too.
  await page.getByRole('button', { name: 'Unmute sound' }).click();
  expect(await storedMute(page)).toBe('false');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Mute sound' })).toBeVisible();
});

test('the preference survives navigating between locales', async ({ page }) => {
  await page.goto('/en/play/bot');
  await page.getByRole('button', { name: 'Mute sound' }).click();

  await page.goto('/de/play/bot');
  await expect(page.getByRole('button', { name: 'Ton einschalten' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('no audio is constructed before a user gesture', { tag: '@core' }, async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __audioContexts: number }).__audioContexts = 0;
    const Original = window.AudioContext;
    if (!Original) return;
    window.AudioContext = class extends Original {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        (window as unknown as { __audioContexts: number }).__audioContexts += 1;
      }
    };
  });

  await page.goto('/en/play/bot');
  await page.waitForTimeout(600);

  const before = await page.evaluate(
    () => (window as unknown as { __audioContexts: number }).__audioContexts,
  );
  expect(before).toBe(0);
});

test(
  'playing a full turn with sound on produces no console errors',
  { tag: '@core' },
  async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/en/play/bot');
    await page.getByRole('button', { name: 'Auto-place' }).click();
    await page.getByRole('button', { name: 'Start the battle' }).click();

    const enemy = page.getByRole('grid', { name: /Enemy waters/i });
    const shootable = enemy.locator('[aria-label*="unexplored"]:not([disabled])');

    for (let shot = 0; shot < 12; shot += 1) {
      if ((await shootable.count()) === 0) {
        await page.waitForTimeout(400);
        continue;
      }
      await shootable.first().click();
      await page.waitForTimeout(60);
    }

    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  },
);

test('muting mid-game keeps the game fully playable', async ({ page }) => {
  await page.goto('/en/play/bot');
  await page.getByRole('button', { name: 'Auto-place' }).click();
  await page.getByRole('button', { name: 'Start the battle' }).click();
  await page.getByRole('button', { name: 'Mute sound' }).click();

  const enemy = page.getByRole('grid', { name: /Enemy waters/i });
  await enemy.locator('[aria-label*="unexplored"]:not([disabled])').first().click();

  await expect(page.locator('ol li').first()).toContainText(/Hit|Miss|Sank/);
});
