import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * A quick match carried to a real finish and then restarted — the sequence a person
 * actually goes through, which the shorter specs skip by resigning immediately.
 *
 * How it ends is left to the game: trading shots until a fleet goes down, or the
 * move clock running out three times along the way. Either is a genuine result, and
 * what this spec is really about is everything that happens *after* one.
 *
 * Needs the realtime Worker as well as the app, so it skips when the Worker is not
 * reachable rather than failing the normal suite.
 */
const WORKER_URL = process.env.PLAYWRIGHT_GAME_WS_HTTP ?? 'http://127.0.0.1:8787';

let workerUp = false;

test.beforeAll(async ({ request }) => {
  try {
    await request.get(WORKER_URL, { timeout: 3000 });
    workerUp = true;
  } catch {
    workerUp = false;
  }
});

test.beforeEach(() => {
  test.skip(!workerUp, `realtime Worker not reachable at ${WORKER_URL} — run npm run worker:dev`);
});

// Sinking twenty cells one click at a time, across two browsers.
test.setTimeout(300_000);

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

async function newPlayer(context: BrowserContext) {
  const page = await context.newPage();
  return { page, problems: watchConsole(page) };
}

/** The enemy grid is the first one on the battle screen. */
const canFire = (page: Page) =>
  page.getByRole('grid').first().locator('[data-cell="0,0"]').isEnabled();

async function startQuickMatch(one: Page, two: Page): Promise<void> {
  for (const page of [one, two]) {
    await page.goto('/en/play/quick');
    await page.getByRole('button', { name: /find an opponent/i }).click();
  }

  for (const page of [one, two]) {
    await expect(page.getByRole('list', { name: /ships to place/i })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: /auto-place/i }).click();
    await page.getByRole('button', { name: /place all ten ships|start the battle/i }).click();
  }

  for (const page of [one, two]) {
    await expect(page.getByRole('grid')).toHaveCount(2, { timeout: 30_000 });
  }
}

/** Fires until somebody wins. Each player sweeps the board from its own end. */
async function playToTheEnd(one: Page, two: Page): Promise<void> {
  const next = new Map<Page, number>([
    [one, 0],
    [two, 99],
  ]);
  const deadline = Date.now() + 240_000;

  while (Date.now() < deadline) {
    if ((await one.getByText(/victory|defeated/i).count()) > 0) {
      return;
    }

    const mover = (await canFire(one)) ? one : (await canFire(two)) ? two : null;
    if (mover === null) {
      // Between turns: the snapshots have not both landed yet.
      await one.waitForTimeout(50);
      continue;
    }

    const step = mover === one ? 1 : -1;
    let cursor = next.get(mover) as number;

    // Skip cells this player has already fired at — the server rejects repeats.
    while (cursor >= 0 && cursor <= 99) {
      const cell = mover
        .getByRole('grid')
        .first()
        .locator(`[data-cell="${cursor % 10},${Math.floor(cursor / 10)}"]`);

      if (await cell.isEnabled()) {
        await cell.click();
        cursor += step;
        break;
      }
      cursor += step;
    }

    next.set(mover, cursor);
  }

  throw new Error('the match did not finish in time');
}

test.describe('a quick match carried to a finish @core', () => {
  test('ends, and neither a reload nor “New match” brings it back', async ({ browser }) => {
    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const one = await newPlayer(firstContext);
    const two = await newPlayer(secondContext);

    await startQuickMatch(one.page, two.page);
    await playToTheEnd(one.page, two.page);

    // Both see a result.
    await expect(one.page.getByText(/victory|defeated/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(two.page.getByText(/victory|defeated/i).first()).toBeVisible({ timeout: 20_000 });

    /**
     * A reload must not resurrect the finished game.
     *
     * This is the other face of the same bug: the match row stayed open, so any
     * route back into matchmaking — a button or a fresh page load — handed the dead
     * game straight back.
     */
    await one.page.reload();
    await expect(one.page.getByRole('button', { name: /find an opponent/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(one.page.getByText(/victory|defeated/i)).toHaveCount(0);

    await one.page.getByRole('button', { name: /find an opponent/i }).click();
    await expect(one.page.getByText(/victory|defeated/i)).toHaveCount(0, { timeout: 15_000 });

    // The other player takes the button route out of the result screen.
    await two.page.getByRole('button', { name: /new match/i }).click();

    // Neither route brings the old game back, and both end up in a new one.
    for (const player of [one, two]) {
      await expect(player.page.getByText(/victory|defeated/i)).toHaveCount(0, { timeout: 30_000 });
    }

    // A genuinely new match: both reach a fresh placement screen.
    for (const player of [one, two]) {
      await expect(player.page.getByRole('list', { name: /ships to place/i })).toBeVisible({
        timeout: 30_000,
      });
    }

    for (const player of [one, two]) {
      await player.page.request.delete('/api/match/quick').catch(() => undefined);
    }

    await firstContext.close();
    await secondContext.close();
  });
});
