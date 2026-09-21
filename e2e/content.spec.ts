import { expect, test } from '@playwright/test';

test('rules and FAQ are reachable from the landing page', async ({ page }) => {
  await page.goto('/en');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'How to play' })
    .click();
  await expect(page).toHaveURL(/\/en\/how-to-play$/);
  await expect(page.getByRole('heading', { level: 1, name: 'How to play' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'FAQ' }).click();
  await expect(page).toHaveURL(/\/en\/faq$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Frequently asked questions' }),
  ).toBeVisible();
});

test('rules are reachable from in-game help', async ({ page }) => {
  await page.goto('/en/play/bot');

  await page.getByRole('link', { name: 'How to play' }).click();

  await expect(page).toHaveURL(/\/en\/how-to-play$/);
  await expect(page.getByRole('heading', { level: 1, name: 'How to play' })).toBeVisible();
});

test('how to play leads back into a game', async ({ page }) => {
  await page.goto('/en/how-to-play');

  await page.getByRole('link', { name: 'Play against the bot' }).click();
  await expect(page).toHaveURL(/\/en\/play\/bot$/);
});

test('how to play states the rules the engine enforces', async ({ page }) => {
  await page.goto('/en/how-to-play');
  const main = page.getByRole('main');

  // Board and fleet.
  await expect(main).toContainText('10 x 10 grid');
  await expect(main).toContainText('1 battleship, 4 squares long');
  await expect(main).toContainText('2 cruisers, 3 squares long');
  await expect(main).toContainText('3 destroyers, 2 squares long');
  await expect(main).toContainText('4 submarines, 1 square each');

  // Orientation, no-touching including diagonals.
  await expect(main).toContainText('horizontally or vertically');
  await expect(main).toContainText('may not touch');
  await expect(main).toContainText('diagonally');

  // Turn structure and outcomes.
  await expect(main).toContainText('A hit earns you another shot.');
  await expect(main).toContainText('only when you miss');
  await expect(main).toContainText('cannot fire at the same square twice');

  // Sinking, buffer cells, win condition.
  await expect(main).toContainText('full outline is revealed');
  await expect(main).toContainText('empty water');
  await expect(main).toContainText('all ten');
});

test('page structure is semantic with one h1 and ordered headings', async ({ page }) => {
  await page.goto('/en/how-to-play');

  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThan(4);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
});

test('every diagram carries a text alternative', async ({ page }) => {
  await page.goto('/en/how-to-play');

  // Scope to the page content: the dev overlay injects its own role="img" nodes.
  const diagrams = page.getByRole('main').getByRole('img');
  const count = await diagrams.count();
  expect(count).toBeGreaterThanOrEqual(5);

  for (let index = 0; index < count; index += 1) {
    const label = await diagrams.nth(index).getAttribute('aria-label');
    expect(label?.length ?? 0).toBeGreaterThan(20);
  }
});

test('FAQ accordion expands and collapses by click', { tag: '@core' }, async ({ page }) => {
  await page.goto('/en/faq');

  const trigger = page.getByRole('button', { name: 'Is it free?' });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('no adverts')).toBeVisible();

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('FAQ accordion is operable by keyboard', { tag: '@core' }, async ({ page }) => {
  await page.goto('/en/faq');

  const trigger = page.getByRole('button', { name: 'Do I need to register?' });
  await trigger.focus();
  await page.keyboard.press('Enter');

  await expect(trigger).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Space');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('FAQ answers do not promise unbuilt features', async ({ page }) => {
  await page.goto('/en/faq');

  await page.getByRole('button', { name: 'Can I play against a friend?' }).click();
  await expect(page.getByText('Not yet')).toBeVisible();

  await page.getByRole('button', { name: 'Is there a rating or a leaderboard?' }).click();
  await expect(page.getByText('not scored or ranked')).toBeVisible();
});

test('content is fully translated in German', async ({ page }) => {
  await page.goto('/de/how-to-play');

  await expect(page.getByRole('heading', { level: 1, name: 'Spielanleitung' })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('dürfen sich nicht berühren');

  await page.goto('/de/faq');
  await expect(page.getByRole('heading', { level: 1, name: 'Häufige Fragen' })).toBeVisible();
  await page.getByRole('button', { name: 'Ist es kostenlos?' }).click();
  await expect(page.getByText('keine Werbung')).toBeVisible();
});

test('untranslated locales fall back to English content', async ({ page }) => {
  await page.goto('/fr/how-to-play');

  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('heading', { level: 1, name: 'How to play' })).toBeVisible();
});
