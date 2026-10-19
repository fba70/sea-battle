import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Everything that competes for the one global matchmaking queue (spec §7.4).
 *
 * Together, and **serial**, on purpose. Quick match pairs whoever is waiting, so two
 * of these running at once put four guests in one pool and pair them across tests —
 * the product behaving correctly, and a test suite that cannot tell. Keeping them in
 * a single file in serial mode means the only players searching at any moment are
 * the ones the running test put there. `playwright.config.ts` also restricts the
 * `@queue` tag to one browser project, for the same reason.
 *
 * Needs the realtime Worker as well as the app, so it skips when the Worker is not
 * reachable rather than failing the normal suite.
 */
const WORKER_URL = process.env.PLAYWRIGHT_GAME_WS_HTTP ?? 'http://127.0.0.1:8787';

let workerUp = false;

test.describe.configure({ mode: 'serial' });

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

/**
 * Two browser sessions, a socket each, and a match played out shot by shot. Slow by
 * nature, and slower again when the rest of the suite is loading the dev server
 * alongside it, so the budget is generous rather than tight.
 */
test.setTimeout(600_000);

/** Placed hulls only — the drag preview is a rect too, tagged `ghost`. */
async function hullCount(page: Page): Promise<number> {
  return page.locator('[data-hull="ship"]').count();
}

async function reachPlacement(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('list', { name: /ships to place|schiffe/i })).toBeVisible({
    timeout: 30_000,
  });
}

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
  /** Cells each player has already fired at, so the test stops re-checking them. */
  const tried = new Map<Page, Set<number>>([
    [one, new Set()],
    [two, new Set()],
  ]);
  const deadline = Date.now() + 480_000;

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
    const seen = tried.get(mover) as Set<number>;
    let cursor = next.get(mover) as number;

    while (cursor >= 0 && cursor <= 99) {
      if (seen.has(cursor)) {
        cursor += step;
        continue;
      }

      const cell = mover
        .getByRole('grid')
        .first()
        .locator(`[data-cell="${cursor % 10},${Math.floor(cursor / 10)}"]`);

      // A cell can also be disabled because a sink revealed it as empty.
      if (await cell.isEnabled()) {
        await cell.click();
        seen.add(cursor);
        cursor += step;
        break;
      }

      seen.add(cursor);
      cursor += step;
    }

    next.set(mover, cursor);
  }

  throw new Error('the match did not finish in time');
}

/** A fresh registered account, so the pair lands in the rated pool. */
async function registerPlayer(page: Page): Promise<string> {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const name = `Rated_${tag}`.slice(0, 20);

  await page.goto('/en/account');
  await page.getByRole('tab', { name: /create account/i }).click();
  await page.getByLabel(/display name/i).fill(name);
  await page.getByLabel(/email/i).fill(`${name.toLowerCase()}@example.test`);
  await page.getByLabel(/password/i).fill('a-good-enough-password');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('link', { name })).toBeVisible({ timeout: 30_000 });

  return name;
}

test.describe('quick match, two independent guests @core @queue', () => {
  test('two waiting players are paired and both reach placement', async ({ browser }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    const one = await newPlayer(first);
    const two = await newPlayer(second);

    for (const player of [one, two]) {
      await player.page.goto('/en/play/quick');
      await player.page.getByRole('button', { name: /find an opponent/i }).click();
    }

    await reachPlacement(one.page);
    await reachPlacement(two.page);

    await one.page.getByRole('button', { name: /auto-place/i }).click();
    expect(await hullCount(one.page)).toBe(10);

    for (const player of [one, two]) {
      expect(player.problems).toEqual([]);
    }

    /*
     * Leave the queue explicitly.
     *
     * A player who simply closes the tab stays matchable until the row goes stale
     * (15s), so back-to-back runs of this spec could otherwise pair with the previous
     * run's ghost and wait forever. That is real product behaviour, not a test bug —
     * but a test should not leave it behind for the next one.
     */
    for (const player of [one, two]) {
      await player.page.request.delete('/api/match/quick').catch(() => undefined);
    }

    await first.close();
    await second.close();
  });
});

test.describe('starting another match afterwards @core @queue', () => {
  test('“New match” starts a fresh search for both players', async ({ browser }) => {
    /**
     * The reported bug: the button did nothing. Quick match renders the live game in
     * place at /play/quick, so a link to /play/quick navigated nowhere and the
     * finished game simply stayed on screen.
     */
    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const one = await newPlayer(firstContext);
    const two = await newPlayer(secondContext);

    for (const player of [one, two]) {
      await player.page.goto('/en/play/quick');
      await player.page.getByRole('button', { name: /find an opponent/i }).click();
    }

    await reachPlacement(one.page);
    await reachPlacement(two.page);

    // Resigning is the quickest honest way to finish a match.
    await one.page.getByRole('button', { name: /^resign$/i }).click();
    await one.page.getByRole('button', { name: /yes, resign/i }).click();
    await expect(one.page.getByText(/you resigned/i)).toBeVisible({ timeout: 20_000 });
    await expect(two.page.getByText(/your opponent resigned/i)).toBeVisible({ timeout: 20_000 });

    // Each player asks for another match on their own, and both leave the finished
    // game behind rather than sitting on the result.
    for (const player of [one, two]) {
      await player.page.getByRole('button', { name: /new match/i }).click();
      await expect(player.page.getByRole('heading', { name: /live match/i })).toHaveCount(0, {
        timeout: 20_000,
      });
    }

    // Two searchers in the same pool pair up again, which is the proof that neither
    // was left holding the old game.
    await reachPlacement(one.page);
    await reachPlacement(two.page);

    for (const [label, player] of [
      ['one', one],
      ['two', two],
    ] as const) {
      expect(player.problems, `${label} console`).toEqual([]);
    }

    for (const player of [one, two]) {
      await player.page.request.delete('/api/match/quick').catch(() => undefined);
    }

    await firstContext.close();
    await secondContext.close();
  });
});

test.describe('a quick match carried to a finish @core @queue', () => {
  test('ends, and neither a reload nor “New match” brings it back', async ({ browser }) => {
    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const one = await newPlayer(firstContext);
    const two = await newPlayer(secondContext);

    await startQuickMatch(one.page, two.page);

    /**
     * Finished by resignation rather than played out.
     *
     * What this test is about is everything *after* a finish — the reload, the
     * button, the fresh match — and any genuine ending exercises that equally.
     * The rated test below plays a match shot by shot; doing it twice in one
     * serial file made the suite minutes slower and load-sensitive enough to
     * time out, for no extra coverage.
     */
    await two.page.getByRole('button', { name: /^resign$/i }).click();
    await two.page.getByRole('button', { name: /yes, resign/i }).click();

    // Both see a result.
    await expect(one.page.getByText(/victory|defeated/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(two.page.getByText(/victory|defeated/i).first()).toBeVisible({ timeout: 20_000 });

    // Spec §7.5's nudge: these players are guests, so the result offers an account.
    await expect(one.page.getByRole('link', { name: /create an account/i })).toBeVisible({
      timeout: 20_000,
    });

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

test.describe('a rated match between two accounts @core @queue', () => {
  test('moves both ratings, shows the change, and matches the profiles', async ({ browser }) => {
    /**
     * The first end-to-end rated game. Rated play needs two registered accounts, so
     * until accounts existed this whole path — pairing, the Glicko update, the
     * number on the result screen, the profile — had never run together.
     */
    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const one = await newPlayer(firstContext);
    const two = await newPlayer(secondContext);

    const nameOne = await registerPlayer(one.page);
    const nameTwo = await registerPlayer(two.page);

    for (const player of [one, two]) {
      await player.page.goto('/en/play/quick');
      await player.page.getByRole('button', { name: /find an opponent/i }).click();
    }

    await reachPlacement(one.page);
    await reachPlacement(two.page);

    for (const player of [one, two]) {
      await player.page.getByRole('button', { name: /auto-place/i }).click();
      await player.page
        .getByRole('button', { name: /place all ten ships|start the battle/i })
        .click();
    }
    for (const player of [one, two]) {
      await expect(player.page.getByRole('grid')).toHaveCount(2, { timeout: 30_000 });
    }

    await playToTheEnd(one.page, two.page);

    // Both see a rating change: one up, one down, and a new rating beside it.
    for (const player of [one, two]) {
      await expect(player.page.getByText(/^[+−]\d+$/)).toBeVisible({ timeout: 30_000 });
      await expect(player.page.getByText(/this game was unrated/i)).toHaveCount(0);
    }

    // The profiles agree with what the result screen said.
    for (const [page, name] of [
      [one.page, nameOne],
      [two.page, nameTwo],
    ] as const) {
      await page.goto('/en/leaderboard');
      await page.getByRole('link', { name: /view your profile/i }).click();

      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 30_000 });
      // One rated game played, and it is in the history with its rating change.
      await expect(page.getByText(/1 rated game/i)).toBeVisible();
      await expect(
        page
          .getByRole('list')
          .getByText(/^[+−]\d+$/)
          .first(),
      ).toBeVisible();
    }

    for (const player of [one, two]) {
      expect(player.problems, 'console').toEqual([]);
    }

    await firstContext.close();
    await secondContext.close();
  });
});
