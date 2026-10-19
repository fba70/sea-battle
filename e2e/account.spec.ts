import { expect, test, type Page } from '@playwright/test';

/**
 * Creating an account and signing in (spec §7.5).
 *
 * Each run registers a fresh identity, so the suite can run repeatedly without
 * colliding with itself on the unique display name.
 */
function unique(): { name: string; email: string } {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { name: `Player_${tag}`.slice(0, 20), email: `player_${tag}@example.test` };
}

const PASSWORD = 'a-good-enough-password';

async function register(page: Page, who: { name: string; email: string }): Promise<void> {
  await page.goto('/en/account');
  await page.getByRole('tab', { name: /create account/i }).click();

  await page.getByLabel(/display name/i).fill(who.name);
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account/i }).click();
}

test('a visitor can create an account and is then signed in @core', async ({ page }) => {
  const who = unique();
  await register(page, who);

  // Landing on the play hub signed in is the whole point.
  await expect(page).toHaveURL(/\/en\/play$/, { timeout: 20_000 });
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 20_000 });
});

test('the same display name cannot be taken twice @core', async ({ browser }) => {
  const who = unique();

  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await register(firstPage, who);
  // Wait for it to land: closing the context mid-request abandons the sign-up, and
  // then the "duplicate" below would be the only one.
  await expect(firstPage.getByRole('link', { name: who.name })).toBeVisible({ timeout: 20_000 });
  await first.close();

  const second = await browser.newContext();
  const page = await second.newPage();
  // Same name, different email, and a different casing — uniqueness folds case.
  await register(page, { name: who.name.toUpperCase().slice(0, 20), email: `other_${who.email}` });

  // Scoped to the page body: Next's route announcer is also role="alert", and it
  // holds the title of whatever was loaded last.
  await expect(page.getByRole('main').getByRole('alert')).toContainText(/taken/i, {
    timeout: 20_000,
  });
  await second.close();
});

test('the form refuses a name that breaks the rules before it is submitted', async ({ page }) => {
  await page.goto('/en/account');
  await page.getByRole('tab', { name: /create account/i }).click();

  await page.getByLabel(/display name/i).fill('has space');
  await expect(page.getByText(/letters, numbers and underscores only/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /create account/i })).toBeDisabled();

  await page.getByLabel(/display name/i).fill('Anonymous');
  await expect(page.getByText(/reserved/i)).toBeVisible();
});

test('signing out and back in keeps the same identity @core', async ({ page }) => {
  const who = unique();
  await register(page, who);
  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible({ timeout: 20_000 });

  await page.goto('/en/account');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 20_000 });
});

test('a wrong password is refused with a readable message', async ({ page }) => {
  const who = unique();
  await register(page, who);
  await page.getByRole('button', { name: /sign out/i }).click();

  await page.goto('/en/account');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill('not-the-password');
  await page.getByRole('button', { name: /^sign in$/i }).click();

  await expect(page.getByRole('main').getByRole('alert')).toContainText(/do not match/i, {
    timeout: 20_000,
  });
});

test('registering while playing as a guest signs you in as the new account @core', async ({
  page,
}) => {
  // Visiting a play page mints the guest session first — this is the spec §7.5
  // conversion path, not a cold registration.
  await page.goto('/en/play/quick');
  await expect(page.getByRole('button', { name: /find an opponent/i })).toBeVisible({
    timeout: 20_000,
  });

  /**
   * Mint the guest directly rather than by searching for an opponent. Joining the
   * queue here would put this test's guest in the same pool as the matchmaking
   * specs and let it steal their partner.
   */
  const minted = await page.request.post('/api/auth/sign-in/anonymous', { data: {} });
  expect(minted.ok()).toBe(true);
  expect((await page.context().cookies()).some((c) => c.name.includes('session'))).toBe(true);

  const who = unique();
  await register(page, who);

  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 20_000 });
});

test('a new account can open its own profile straight away @core', async ({ page }) => {
  /**
   * The reported bug: the header links to your profile, and a brand-new account had
   * no rating row yet, so the page 404'd on our own link.
   */
  const who = unique();
  await register(page, who);

  await page.getByRole('link', { name: who.name }).click();

  await expect(page).toHaveURL(/\/en\/players\//, { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1, name: who.name })).toBeVisible();
  // The starting rating, and an honest explanation of why there is no rank yet.
  await expect(page.getByText('1500')).toBeVisible();
  await expect(page.getByText(/no rated games yet/i)).toBeVisible();
});

test('the profile still opens after signing out and back in', async ({ page }) => {
  const who = unique();
  await register(page, who);
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible({ timeout: 20_000 });

  await page.goto('/en/account');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  // Signing in navigates to the play hub. Clicking the header link before that
  // lands loses the click to the navigation already under way.
  await expect(page).toHaveURL(/\/en\/play$/, { timeout: 20_000 });

  await page.getByRole('link', { name: who.name }).click();
  await expect(page.getByRole('heading', { level: 1, name: who.name })).toBeVisible({
    timeout: 20_000,
  });
});

test('German renders the account page without raw keys', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'de-DE' });
  const page = await context.newPage();

  await page.goto('/de/account');
  await expect(page.getByRole('heading', { level: 1, name: 'Dein Konto' })).toBeVisible();

  const body = (await page.locator('body').innerText()).toUpperCase();
  expect(body).not.toMatch(/ACCOUNT\.|NAV\./);

  await context.close();
});

test('signing in with the display name works as well as the email @core', async ({ page }) => {
  const who = unique();
  await register(page, who);
  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible({ timeout: 20_000 });

  // Retried: signing out refreshes the page, and a navigation issued into that
  // refresh is aborted outright rather than queued.
  await expect(async () => {
    await page.goto('/en/account');
    await expect(page.getByLabel(/email or username/i)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  // Upper-cased on purpose: the username matches the way uniqueness does.
  await page.getByLabel(/email or username/i).fill(who.name.toUpperCase());
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 20_000 });
});

test('an unknown username is refused exactly like a wrong password', async ({ page }) => {
  await page.goto('/en/account');
  await page.getByLabel(/email or username/i).fill('Nobody_At_All');
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  // Never "no such player": the form must not say which names are registered.
  await expect(page.getByRole('main').getByRole('alert')).toContainText(/do not match/i, {
    timeout: 20_000,
  });
});

test('your own profile offers a sign-out button; nobody else’s does @core', async ({ browser }) => {
  const owner = await browser.newContext();
  const page = await owner.newPage();

  const who = unique();
  await register(page, who);
  await page.getByRole('link', { name: who.name }).click();
  await expect(page).toHaveURL(/\/en\/players\//, { timeout: 20_000 });
  const profile = page.url();

  // One on the profile itself, one in the header.
  await expect(page.getByRole('main').getByRole('button', { name: /sign out/i })).toBeVisible();

  // Somebody else's view of the same profile: readable, with nothing to sign out of.
  const other = await browser.newContext();
  const visitor = await other.newPage();
  const them = unique();
  await register(visitor, them);
  await visitor.goto(profile);

  await expect(visitor.getByRole('heading', { level: 1, name: who.name })).toBeVisible({
    timeout: 20_000,
  });
  await expect(visitor.getByRole('main').getByRole('button', { name: /sign out/i })).toBeHidden();
  await other.close();

  // And it signs you out where it is offered.
  await page
    .getByRole('main')
    .getByRole('button', { name: /sign out/i })
    .click();
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('main').getByRole('button', { name: /sign out/i })).toBeHidden();

  // Spec §7.7: a profile stays public, including to a guest.
  await expect(page.getByRole('heading', { level: 1, name: who.name })).toBeVisible();
  await owner.close();
});

test('a guest can read a public profile @core', async ({ browser }) => {
  const owner = await browser.newContext();
  const page = await owner.newPage();
  const who = unique();
  await register(page, who);
  await page.getByRole('link', { name: who.name }).click();
  await expect(page).toHaveURL(/\/en\/players\//, { timeout: 20_000 });
  const profile = page.url();
  await owner.close();

  // A browser that has never signed in to anything.
  const guest = await browser.newContext();
  const visitor = await guest.newPage();
  await visitor.goto(profile);

  await expect(visitor.getByRole('heading', { level: 1, name: who.name })).toBeVisible({
    timeout: 20_000,
  });
  await expect(visitor.getByText('1500')).toBeVisible();
  // The match list is private (spec §2), the rest of the profile is not.
  await expect(visitor.getByText(/history is private/i)).toBeVisible();
  await guest.close();
});
