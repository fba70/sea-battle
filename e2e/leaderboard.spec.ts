import { expect, test, type Page } from '@playwright/test';

/**
 * The leaderboard and profile surfaces (spec §7.7, §7.5).
 *
 * The database a dev machine points at normally has no ranked players, so these
 * assert the states that are always reachable: the empty board, the guest standing
 * card, the stated criteria, and the privacy rule on profiles. The ranked table
 * itself is covered by the store's unit tests.
 */

/** Console errors and next-intl's missing-key reports. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' || text.includes('MISSING_MESSAGE')) {
      problems.push(text);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

test('the leaderboard is reachable from the main navigation @core', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/en');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Leaderboard' })
    .click();

  // Generous: against a dev server this is the first request to compile the route,
  // and it queries the database before it can render.
  await expect(page).toHaveURL(/\/en\/leaderboard$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Leaderboard' })).toBeVisible({
    timeout: 20_000,
  });
  expect(problems).toEqual([]);
});

test('an empty ladder explains itself instead of showing an empty table @core', async ({
  page,
}) => {
  await page.goto('/en/leaderboard');

  const main = page.getByRole('main');
  const ranked = await main.getByRole('table').count();

  if (ranked === 0) {
    await expect(main.getByText('No one has qualified yet')).toBeVisible();
    await expect(main.getByRole('link', { name: 'Play a rated match' }).first()).toBeVisible();
  } else {
    // A seeded database: the table must carry the ranking columns.
    await expect(main.getByRole('columnheader', { name: 'Rating' })).toBeVisible();
  }
});

test('the criteria on the page match the policy the query applies', async ({ page }) => {
  await page.goto('/en/leaderboard');
  const main = page.getByRole('main');

  // 10 rated games, RD below 150, active within 30 days — Block 8A's constants.
  await expect(main).toContainText('10 rated matches');
  await expect(main).toContainText('below 150');
  await expect(main).toContainText('30 days');
});

test('a visitor without a rating is told why, and how to get one', async ({ page }) => {
  await page.goto('/en/leaderboard');

  await expect(page.getByRole('heading', { name: /not rated yet/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Play a rated match' }).first()).toBeVisible();
});

test('an unknown player profile is a 404, not a blank page', async ({ page }) => {
  const response = await page.goto('/en/players/no-such-player');
  expect(response?.status()).toBe(404);
});

test('the API serves the board without exposing board state', async ({ request }) => {
  const response = await request.get('/api/leaderboard');
  expect(response.ok()).toBe(true);

  const body = await response.text();
  // games.boards_json holds both fleets; nothing resembling it may appear here.
  expect(body).not.toContain('boards');
  expect(body).not.toContain('fleet');

  const json = JSON.parse(body) as { entries: unknown[]; rankedCount: number; you: unknown };
  expect(Array.isArray(json.entries)).toBe(true);
  expect(typeof json.rankedCount).toBe('number');
});

test('German renders the leaderboard without raw keys @core', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'de-DE' });
  const page = await context.newPage();
  const problems = watchConsole(page);

  await page.goto('/de/leaderboard');

  await expect(page.getByRole('heading', { level: 1, name: 'Rangliste' })).toBeVisible();
  const body = (await page.locator('body').innerText()).toUpperCase();
  expect(body).not.toMatch(/LEADERBOARD\.|PROFILE\.|NAV\./);
  expect(problems).toEqual([]);

  await context.close();
});
