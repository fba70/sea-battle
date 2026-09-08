import { expect, test, type Page } from '@playwright/test';

async function startMatchViaAutoPlace(page: Page) {
  await page.goto('/en/play/bot');
  await page.getByRole('button', { name: 'Auto-place' }).click();
  await page.getByRole('button', { name: 'Start the battle' }).click();
}

test('landing page links into the bot match', async ({ page }) => {
  await page.goto('/en');
  await page.getByRole('link', { name: 'Play against the bot' }).click();

  await expect(page).toHaveURL(/\/en\/play\/bot$/);
  await expect(page.getByRole('heading', { name: 'Battle against the bot' })).toBeVisible();
});

test('auto-place fills the fleet and enables the start button', async ({ page }) => {
  await page.goto('/en/play/bot');

  const start = page.getByRole('button', { name: 'Place all ten ships' });
  await expect(start).toBeDisabled();

  await page.getByRole('button', { name: 'Auto-place' }).click();

  await expect(page.getByRole('button', { name: 'Start the battle' })).toBeEnabled();
});

test('manual placement: selecting a ship and clicking a square places it', async ({ page }) => {
  await page.goto('/en/play/bot');

  // The battleship is preselected (largest first); place it at A1.
  await page
    .getByRole('grid', { name: /place your ships/i })
    .getByRole('gridcell')
    .first()
    .click();

  await expect(page.getByRole('button', { name: /Battleship/ })).toBeDisabled();
});

test('placing a ship where it would touch another is rejected', async ({ page }) => {
  await page.goto('/en/play/bot');
  const grid = page.getByRole('grid', { name: /place your ships/i });

  // Battleship at A1-D1.
  await grid.getByRole('gridcell').nth(0).click();
  // Now a cruiser at E1 would touch it; the tray count must not drop.
  await grid.getByRole('gridcell').nth(4).click();

  await expect(page.getByRole('button', { name: /Cruiser/ })).toContainText('2/2');
});

test('plays a full turn: firing resolves and the status updates', async ({ page }) => {
  await startMatchViaAutoPlace(page);

  await expect(page.getByRole('grid', { name: /Enemy waters/i })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Your turn');

  const enemy = page.getByRole('grid', { name: /Enemy waters/i });
  await enemy.getByRole('gridcell').nth(0).click();

  // A shot always produces a log entry, whether it hit or missed.
  await expect(page.getByText('Recent shots')).toBeVisible();
  await expect(page.locator('ol li').first()).toContainText(/Hit|Miss|Sank/);
});

test('keyboard play: arrow keys move the cursor and Enter fires', async ({ page }) => {
  await startMatchViaAutoPlace(page);

  const enemy = page.getByRole('grid', { name: /Enemy waters/i });
  await enemy.getByRole('gridcell').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(page.locator('ol li').first()).toContainText(/Hit|Miss|Sank/);
});

test('the opponent board never contains the bot fleet in the DOM', async ({ page }) => {
  await startMatchViaAutoPlace(page);

  const enemy = page.getByRole('grid', { name: /Enemy waters/i });
  const labels = await enemy.getByRole('gridcell').allTextContents();
  expect(labels.join(' ')).not.toContain('ship');

  // Every enemy cell starts unexplored — nothing is pre-revealed.
  const unexplored = await enemy.locator('[aria-label*="unexplored"]').count();
  expect(unexplored).toBe(100);
});

test('difficulty is selectable before the battle starts', async ({ page }) => {
  await page.goto('/en/play/bot');

  await page.getByRole('radio', { name: 'Hard' }).click();
  await expect(page.getByRole('radio', { name: 'Hard' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Playing against Hard')).toBeVisible();
});

test('German locale renders the game UI translated', async ({ page }) => {
  await page.goto('/de/play/bot');

  await expect(page.getByRole('heading', { name: 'Kampf gegen den Bot' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Automatisch platzieren' })).toBeVisible();
});

test('plays a complete match through to a decided result', async ({ page }) => {
  test.setTimeout(180_000);
  await startMatchViaAutoPlace(page);

  const enemy = page.getByRole('grid', { name: /Enemy waters/i });
  // Only ever click a cell that is actually shootable right now: during the bot's
  // thinking delay every cell is disabled, and once the game ends they stay that way.
  const shootable = enemy.locator('[aria-label*="unexplored"]:not([disabled])');
  const result = page.getByRole('alertdialog');

  for (let shot = 0; shot < 120; shot += 1) {
    // Race the bot: either the game is over, or it is our turn again.
    await expect
      .poll(async () => (await result.isVisible()) || (await shootable.count()) > 0, {
        timeout: 30_000,
      })
      .toBe(true);

    if (await result.isVisible()) break;
    await shootable.first().click();
  }

  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText(/Victory|Defeated/);

  // And the match can be restarted from the overlay.
  await page.getByRole('button', { name: 'Play again' }).click();
  await expect(page.getByRole('button', { name: 'Auto-place' })).toBeVisible();
});
