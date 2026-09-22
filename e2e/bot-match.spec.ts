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

test(
  'manual placement: selecting a ship and clicking a square places it',
  { tag: '@core' },
  async ({ page }) => {
    await page.goto('/en/play/bot');

    // The battleship is preselected (largest first); place it at A1.
    await page
      .getByRole('grid', { name: /place your ships/i })
      .getByRole('gridcell')
      .first()
      .click();

    await expect(page.getByRole('button', { name: /Battleship/ })).toBeDisabled();
  },
);
test(
  'the action bar never covers the fleet tray while ships are still to place',
  { tag: '@core' },
  async ({ page }) => {
    await page.goto('/en/play/bot');

    // Regression guard: a pinned but disabled "Place all ten ships" bar used to
    // float over the whole tray on short viewports, hiding the controls needed
    // to finish placing (§7.10: placement must be completable on a 360px phone).
    for (const ship of ['Battleship', 'Cruiser', 'Destroyer', 'Submarine']) {
      const entry = page.getByRole('button', { name: new RegExp(ship) });
      await entry.scrollIntoViewIfNeeded();
      const box = await entry.boundingBox();
      if (!box) throw new Error(`${ship} tray row is not laid out`);

      const onTop = await page.evaluate(
        ([x, y]) => {
          const element = document.elementFromPoint(x as number, y as number);
          return element?.closest('button')?.textContent ?? element?.tagName ?? null;
        },
        [box.x + box.width / 2, box.y + box.height / 2],
      );

      expect(onTop, `${ship} row is obscured by another element`).toContain(ship);
    }
  },
);

test(
  'the action bar is reachable once the fleet is complete',
  { tag: '@core' },
  async ({ page }) => {
    await page.goto('/en/play/bot');
    await page.getByRole('button', { name: 'Auto-place' }).click();

    const start = page.getByRole('button', { name: 'Start the battle' });
    await expect(start).toBeEnabled();
    // Clickable without any manual scrolling — Playwright fails here if it is
    // covered or off-screen.
    await start.click();

    await expect(page.getByRole('grid', { name: /Enemy waters/i })).toBeVisible();
  },
);

test(
  'a cancelled drag abandons the ship instead of placing it',
  { tag: '@core' },
  async ({ page }) => {
    await page.goto('/en/play/bot');

    const battleship = page.getByRole('button', { name: /Battleship/ });
    const grid = page.getByRole('grid', { name: /place your ships/i });
    await page.evaluate(() => window.scrollBy(0, 260));
    await page.waitForTimeout(100);

    const tray = await battleship.boundingBox();
    const board = await grid.boundingBox();
    if (!tray || !board) throw new Error('expected a laid-out board and tray');
    const cell = board.width / 10;

    await page.mouse.move(tray.x + tray.width / 2, tray.y + tray.height / 2);
    await page.mouse.down();
    await page.mouse.move(board.x + 3.5 * cell, board.y + 3.5 * cell, { steps: 8 });

    // iOS fires pointercancel whenever the browser claims the gesture — a scroll,
    // a system swipe, an incoming call. That must abandon the drag, never commit it.
    await page.evaluate(() => {
      window.dispatchEvent(
        new PointerEvent('pointercancel', { bubbles: true, clientX: 0, clientY: 0 }),
      );
    });
    await page.waitForTimeout(300);

    // Still unplaced: no ship was committed by the cancellation.
    await expect(battleship).toBeEnabled();
    await expect(battleship).toContainText('1 left');
  },
);

test('the fleet tray does not swallow vertical scrolling', { tag: '@core' }, async ({ page }) => {
  await page.goto('/en/play/bot');

  // `touch-action: none` on the tray stopped the page scrolling whenever a
  // touch began on a tray row, and the tray covers a third of a phone screen.
  const touchAction = await page
    .getByRole('button', { name: /Battleship/ })
    .evaluate((el) => getComputedStyle(el).touchAction);

  expect(touchAction).not.toBe('none');
  expect(touchAction).toContain('pan-y');
});

test(
  'places a ship by dragging it from the tray onto the grid',
  { tag: '@core' },
  async ({ page }) => {
    await page.goto('/en/play/bot');

    const battleship = page.getByRole('button', { name: /Battleship/ });
    const grid = page.getByRole('grid', { name: /place your ships/i });

    // On narrow viewports the sticky action bar is pinned over the bottom of the
    // page, covering the tray, so scroll it clear first — a player must do the
    // same. On desktop there is nothing to scroll and this is a no-op.
    await page.evaluate(() => window.scrollBy(0, 260));
    await page.waitForTimeout(100);

    const tray = await battleship.boundingBox();
    const board = await grid.boundingBox();
    const viewport = page.viewportSize();
    if (!tray || !board || !viewport) throw new Error('expected a laid-out board and tray');

    // Drop on column D of the first board row comfortably on screen; a
    // four-square ship starting there still fits within the board.
    const cell = board.width / 10;
    const row = [3, 4, 5, 6, 7, 8, 9, 2, 1, 0].find((candidate) => {
      const y = board.y + (candidate + 0.5) * cell;
      return y > 80 && y < viewport.height - 120;
    });
    if (row === undefined) throw new Error('no board row is visible to drop onto');

    await page.mouse.move(tray.x + tray.width / 2, tray.y + tray.height / 2);
    await page.mouse.down();
    await page.mouse.move(board.x + 3.5 * cell, board.y + (row + 0.5) * cell, { steps: 16 });
    await page.mouse.up();

    // The hull is consumed, so the tray entry is exhausted.
    await expect(battleship).toBeDisabled();
    await expect(battleship).toContainText('Placed');
  },
);

test(
  'placing a ship where it would touch another is rejected',
  { tag: '@core' },
  async ({ page }) => {
    await page.goto('/en/play/bot');
    const grid = page.getByRole('grid', { name: /place your ships/i });

    // Battleship at A1-D1.
    await grid.getByRole('gridcell').nth(0).click();
    // Now a cruiser at E1 would touch it; the tray count must not drop.
    await grid.getByRole('gridcell').nth(4).click();

    await expect(page.getByRole('button', { name: /Cruiser/ })).toContainText('2 left');
  },
);

test(
  'plays a full turn: firing resolves and the status updates',
  { tag: '@core' },
  async ({ page }) => {
    await startMatchViaAutoPlace(page);

    await expect(page.getByRole('grid', { name: /Enemy waters/i })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Your turn');

    const enemy = page.getByRole('grid', { name: /Enemy waters/i });
    await enemy.getByRole('gridcell').nth(0).click();

    // A shot always produces a log entry, whether it hit or missed.
    await expect(page.getByText('Recent shots')).toBeVisible();
    await expect(page.locator('ol li').first()).toContainText(/Hit|Miss|Sank/);
  },
);

test(
  'keyboard play: arrow keys move the cursor and Enter fires',
  { tag: '@core' },
  async ({ page }) => {
    await startMatchViaAutoPlace(page);

    const enemy = page.getByRole('grid', { name: /Enemy waters/i });
    await enemy.getByRole('gridcell').first().focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.locator('ol li').first()).toContainText(/Hit|Miss|Sank/);
  },
);

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

test('plays a complete match through to a decided result', { tag: '@core' }, async ({ page }) => {
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
