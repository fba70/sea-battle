import { expect, test, type Page } from '@playwright/test';

const LOCALES = ['en', 'de', 'es', 'it', 'fr'] as const;

/** Any element whose own content is wider than its box, or that overflows the page. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return {
      horizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
      clipped: [...document.querySelectorAll<HTMLElement>('header *')]
        .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim())
        // sr-only text is clipped to 1px on purpose; it is not a layout fault.
        .filter((el) => !el.className.toString().includes('sr-only'))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => (el.textContent ?? '').trim().slice(0, 30)),
    };
  });
}

/**
 * §7.14 / §8: the layout must flex for text expansion, not assume English
 * widths. Spanish and Italian nav labels are roughly twice the English length.
 */
test.describe('header survives text expansion at the 360px floor', () => {
  for (const locale of LOCALES) {
    test(`${locale} header lays out cleanly`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto(`/${locale}/faq`);

      const brand = await page.getByRole('link', { name: 'SeaDuel' }).boundingBox();
      const nav = await page.getByRole('navigation', { name: /Main|Haupt/ }).boundingBox();
      const select = await page.getByRole('combobox').first().boundingBox();
      if (!brand || !nav || !select) throw new Error('header parts not laid out');

      // Row 1: brand and the locale selector share a line.
      expect(Math.abs(brand.y - select.y)).toBeLessThan(brand.height);
      // Row 2: navigation sits below both, never stranded beside them.
      expect(nav.y).toBeGreaterThan(brand.y + brand.height - 2);
      // The selector is the right-most thing on its row.
      expect(select.x).toBeGreaterThan(brand.x + brand.width);

      const { horizontalScroll, clipped } = await overflow(page);
      expect(horizontalScroll, `${locale} causes sideways page scroll`).toBe(false);
      expect(clipped, `${locale} header text is clipped`).toEqual([]);
    });
  }
});

test('desktop header stays a single row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/es/faq');

  const brand = await page.getByRole('link', { name: 'SeaDuel' }).boundingBox();
  const nav = await page.getByRole('navigation', { name: /Main|Principal/ }).boundingBox();
  const select = await page.getByRole('combobox').first().boundingBox();
  if (!brand || !nav || !select) throw new Error('header parts not laid out');

  // All three share one line.
  expect(Math.abs(brand.y - nav.y)).toBeLessThan(brand.height);
  expect(Math.abs(brand.y - select.y)).toBeLessThan(brand.height);
});

/**
 * The result modal must be centred on the viewport the player is looking at.
 * The board can be scrolled far out of view on a phone.
 */
test('result modal is centred on the viewport, not the board', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/en/play/bot');

  await page.getByRole('button', { name: 'Auto-place' }).click();
  await page.getByRole('button', { name: 'Start the battle' }).click();

  const enemy = page.getByRole('grid', { name: /Enemy waters/i });
  const shootable = enemy.locator('[aria-label*="unexplored"]:not([disabled])');
  const result = page.getByRole('alertdialog');

  for (let shot = 0; shot < 120; shot += 1) {
    await expect
      .poll(async () => (await result.isVisible()) || (await shootable.count()) > 0, {
        // Generous: a full match runs here, and the bot's turn timer stretches
        // under load. The condition is unchanged, only the patience.
        timeout: 60_000,
      })
      .toBe(true);
    if (await result.isVisible()) break;
    await shootable.first().click();
  }

  await expect(result).toBeVisible({ timeout: 30_000 });

  // Scroll far away from the board; the modal must stay put on screen.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);

  const box = await result.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('modal not laid out');

  expect(box.y, 'modal starts above the viewport').toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height, 'modal extends below the viewport').toBeLessThanOrEqual(
    viewport.height + 1,
  );

  // Its buttons are reachable without scrolling back to the board.
  await expect(page.getByRole('button', { name: 'Play again' })).toBeInViewport();
});

test('result modal keeps keyboard focus inside itself', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/en/play/bot');
  await page.getByRole('button', { name: 'Auto-place' }).click();
  await page.getByRole('button', { name: 'Start the battle' }).click();

  const enemy = page.getByRole('grid', { name: /Enemy waters/i });
  const shootable = enemy.locator('[aria-label*="unexplored"]:not([disabled])');
  const result = page.getByRole('alertdialog');

  for (let shot = 0; shot < 120; shot += 1) {
    await expect
      .poll(async () => (await result.isVisible()) || (await shootable.count()) > 0, {
        // Generous: a full match runs here, and the bot's turn timer stretches
        // under load. The condition is unchanged, only the patience.
        timeout: 60_000,
      })
      .toBe(true);
    if (await result.isVisible()) break;
    await shootable.first().click();
  }
  await expect(result).toBeVisible({ timeout: 30_000 });

  // Tab around the dialog; focus must never escape to the board behind it.
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="alertdialog"]');
      return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
    });
    expect(inside, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
  }
});
