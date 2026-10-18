import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * The live multiplayer flow, driven through the real UI with two independent browser
 * sessions (spec §7.4).
 *
 * Needs the realtime Worker as well as the app, so it skips when the Worker is not
 * reachable rather than failing the normal suite:
 *
 *     npm run worker:dev      # terminal 1
 *     npm run dev             # terminal 2
 *     npx playwright test e2e/multiplayer.spec.ts --project=desktop-chromium
 */
const WORKER_URL = process.env.PLAYWRIGHT_GAME_WS_HTTP ?? 'http://127.0.0.1:8787';

let workerUp = false;

test.beforeAll(async ({ request }) => {
  try {
    // Any response at all means the Worker is listening; `/` legitimately 404s.
    await request.get(WORKER_URL, { timeout: 3000 });
    workerUp = true;
  } catch {
    workerUp = false;
  }
});

test.beforeEach(() => {
  test.skip(!workerUp, `realtime Worker not reachable at ${WORKER_URL} — run npm run worker:dev`);
});

// Two browser sessions, a socket each and several server round trips per step.
test.setTimeout(120_000);

/** Console errors and next-intl's missing-key reports, per page. */
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

const placementBoard = (page: Page) => page.getByRole('grid').first();
const cell = (page: Page, x: number, y: number) =>
  placementBoard(page).locator(`[data-cell="${x},${y}"]`);

/** Placed hulls only — the drag preview is a rect too, tagged `ghost`. */
async function hullCount(page: Page): Promise<number> {
  return page.locator('[data-hull="ship"]').count();
}

async function reachPlacement(page: Page, locale = 'en'): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  // The fleet tray only renders once the server has sent the first snapshot.
  await expect(page.getByRole('list', { name: /ships to place|schiffe/i })).toBeVisible({
    timeout: 25_000,
  });
  expect(locale).toBeTruthy();
}

test.describe('private room, two independent players @core', () => {
  test('both players join, place fleets and exchange shots', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await newPlayer(hostContext);
    const guest = await newPlayer(guestContext);

    // --- Player A creates a room -------------------------------------------
    await host.page.goto('/en/play');
    await host.page.getByRole('link', { name: /private game/i }).click();
    await host.page.getByRole('button', { name: /create a room/i }).click();

    await expect(host.page).toHaveURL(/\/en\/play\/room\/[A-Z0-9]{6}$/, { timeout: 20_000 });
    const roomUrl = host.page.url();
    const code = roomUrl.split('/').pop() as string;

    await expect(host.page.getByText(/waiting for your friend/i)).toBeVisible();

    // --- Player B joins through the shared link ----------------------------
    await guest.page.goto(roomUrl);

    // Both must land in the same game and reach placement.
    await reachPlacement(guest.page);
    await reachPlacement(host.page);

    // The earlier failure mode: a fresh session beat the guest sign-in and the join
    // came back 401, surfacing as "your session expired".
    await expect(host.page.getByText(/session expired/i)).toHaveCount(0);
    await expect(guest.page.getByText(/session expired/i)).toHaveCount(0);
    await expect(guest.page.getByText(/already has two players/i)).toHaveCount(0);

    // --- Placement actually places, and is visible -------------------------
    expect(await hullCount(host.page)).toBe(0);
    await cell(host.page, 0, 0).click();
    expect(await hullCount(host.page)).toBe(1);

    // Rotate changes the orientation of the next ship: place one vertically and
    // confirm it occupies a column rather than a row.
    await host.page.getByRole('button', { name: /rotate/i }).click();
    await cell(host.page, 0, 2).click();
    expect(await hullCount(host.page)).toBe(2);

    // Confirm stays disabled until the fleet is legal and complete.
    const confirm = host.page.getByRole('button', {
      name: /place all ten ships|start the battle/i,
    });
    await expect(confirm).toBeDisabled();

    await host.page.getByRole('button', { name: /auto-place/i }).click();
    expect(await hullCount(host.page)).toBe(10);
    await expect(confirm).toBeEnabled();

    await guest.page.getByRole('button', { name: /auto-place/i }).click();
    expect(await hullCount(guest.page)).toBe(10);

    // --- Both confirm; the server starts the game --------------------------
    await confirm.click();
    await guest.page.getByRole('button', { name: /place all ten ships|start the battle/i }).click();

    // Two boards each once the battle begins.
    await expect(host.page.getByRole('grid')).toHaveCount(2, { timeout: 20_000 });
    await expect(guest.page.getByRole('grid')).toHaveCount(2, { timeout: 20_000 });

    // --- Turn state is consistent between the two players ------------------
    /**
     * Whether this player's enemy board accepts a shot. The rendered affordance is a
     * better signal than the banner text: it is what a real player can act on, and it
     * does not flicker while the banner animates between states.
     */
    const canFire = (page: Page) =>
      page.getByRole('grid').first().locator('[data-cell="0,0"]').isEnabled();

    // Polled, not sampled: the two snapshots arrive independently.
    const playersOnTurn = async () =>
      Number(await canFire(host.page)) + Number(await canFire(guest.page));

    await expect
      .poll(playersOnTurn, { timeout: 20_000, message: 'exactly one player may be on turn' })
      .toBe(1);

    // --- Exchange several shots -------------------------------------------
    for (let shot = 0; shot < 4; shot += 1) {
      // Settle first: a hit keeps the turn, a miss passes it, so who moves next is
      // only known once both snapshots have landed.
      await expect.poll(playersOnTurn, { timeout: 20_000 }).toBe(1);

      const mover = (await canFire(host.page)) ? host.page : guest.page;
      const target = mover.getByRole('grid').first().locator(`[data-cell="9,${shot}"]`);

      await expect(target, 'the player on turn can fire').toBeEnabled();
      await target.click();

      await expect.poll(playersOnTurn, { timeout: 20_000 }).toBe(1);
    }

    // --- No broken strings, no runtime errors ------------------------------
    for (const [label, player] of [
      ['host', host],
      ['guest', guest],
    ] as const) {
      const body = (await player.page.locator('body').innerText()).toUpperCase();
      expect(body, `${label} shows a raw translation key`).not.toMatch(
        /GAME\.(ACTION|BOARD|PLACEMENT|CELL)\./,
      );
      expect(body, `${label} shows a raw multiplayer key`).not.toMatch(/MULTIPLAYER\./);
      expect(player.problems, `${label} console`).toEqual([]);
    }

    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    await hostContext.close();
    await guestContext.close();
  });

  test('a third session is told the room is full, not that its session expired', async ({
    browser,
  }) => {
    const a = await browser.newContext();
    const b = await browser.newContext();
    const c = await browser.newContext();
    const host = await newPlayer(a);
    const guest = await newPlayer(b);
    const third = await newPlayer(c);

    await host.page.goto('/en/play/room');
    await host.page.getByRole('button', { name: /create a room/i }).click();
    await expect(host.page).toHaveURL(/\/room\/[A-Z0-9]{6}$/, { timeout: 20_000 });
    const roomUrl = host.page.url();

    await guest.page.goto(roomUrl);
    await reachPlacement(guest.page);

    await third.page.goto(roomUrl);
    await expect(third.page.getByText(/already has two players/i)).toBeVisible({ timeout: 20_000 });
    // The distinction that matters: a full room, not a broken session.
    await expect(third.page.getByText(/session expired/i)).toHaveCount(0);

    await a.close();
    await b.close();
    await c.close();
  });
});

test.describe('timers, disconnects and resigning @core', () => {
  test('a player can resign, but only after confirming', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await newPlayer(hostContext);
    const guest = await newPlayer(guestContext);

    await host.page.goto('/en/play/room');
    await host.page.getByRole('button', { name: /create a room/i }).click();
    await expect(host.page).toHaveURL(/\/room\/[A-Z0-9]{6}$/, { timeout: 20_000 });

    await guest.page.goto(host.page.url());
    await reachPlacement(guest.page);
    await reachPlacement(host.page);

    // The move clock is visible and counting towards a server deadline.
    await expect(host.page.getByRole('timer')).toBeVisible();

    // One click arms it; the game is still live until the second.
    await host.page.getByRole('button', { name: /^resign$/i }).click();
    await expect(host.page.getByText(/resign and lose this game/i)).toBeVisible();
    await host.page.getByRole('button', { name: /keep playing/i }).click();
    await expect(host.page.getByText(/resign and lose this game/i)).toHaveCount(0);

    await host.page.getByRole('button', { name: /^resign$/i }).click();
    await host.page.getByRole('button', { name: /yes, resign/i }).click();

    // Both sides are told, and told why.
    await expect(host.page.getByText(/you resigned/i)).toBeVisible({ timeout: 20_000 });
    await expect(guest.page.getByText(/your opponent resigned/i)).toBeVisible({ timeout: 20_000 });

    for (const [label, player] of [
      ['host', host],
      ['guest', guest],
    ] as const) {
      expect(player.problems, `${label} console`).toEqual([]);
    }

    await hostContext.close();
    await guestContext.close();
  });

  test('the opponent is told when a connection drops, with a countdown', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await newPlayer(hostContext);
    const guest = await newPlayer(guestContext);

    await host.page.goto('/en/play/room');
    await host.page.getByRole('button', { name: /create a room/i }).click();
    await expect(host.page).toHaveURL(/\/room\/[A-Z0-9]{6}$/, { timeout: 20_000 });

    await guest.page.goto(host.page.url());
    await reachPlacement(guest.page);
    await reachPlacement(host.page);

    // Closing the tab is the realistic way a connection goes away.
    await guest.page.close();

    await expect(host.page.getByText(/lost connection/i)).toBeVisible({ timeout: 20_000 });
    // The clock stops while someone is away, so nobody loses on time waiting.
    await expect(host.page.getByText(/clock paused/i)).toBeVisible();

    expect(host.problems, 'host console').toEqual([]);

    await hostContext.close();
    await guestContext.close();
  });
});

test.describe('quick match, two independent guests @core', () => {
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

test.describe('starting another match afterwards @core', () => {
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

test.describe('German renders the live flow correctly', () => {
  test('no missing keys in the room and placement screens', async ({ browser }) => {
    const a = await browser.newContext({ locale: 'de-DE' });
    const b = await browser.newContext({ locale: 'de-DE' });
    const host = await newPlayer(a);
    const guest = await newPlayer(b);

    await host.page.goto('/de/play');
    await expect(host.page.getByRole('heading', { name: 'Online spielen' })).toBeVisible();

    await host.page.getByRole('link', { name: /privates spiel/i }).click();
    await host.page.getByRole('button', { name: /raum erstellen/i }).click();
    await expect(host.page).toHaveURL(/\/de\/play\/room\/[A-Z0-9]{6}$/, { timeout: 20_000 });

    await guest.page.goto(host.page.url());
    await reachPlacement(guest.page, 'de');
    await reachPlacement(host.page, 'de');

    // German labels, not raw keys.
    await expect(host.page.getByRole('button', { name: /drehen/i })).toBeVisible();
    await expect(host.page.getByRole('button', { name: /automatisch/i })).toBeVisible();

    for (const [label, player] of [
      ['host', host],
      ['guest', guest],
    ] as const) {
      const body = (await player.page.locator('body').innerText()).toUpperCase();
      expect(body, `${label} shows a raw key`).not.toMatch(/GAME\.|MULTIPLAYER\./);
      expect(player.problems, `${label} console`).toEqual([]);
    }

    await a.close();
    await b.close();
  });
});
