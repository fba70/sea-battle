import { expect, test, type Page } from '@playwright/test';

/**
 * Email verification and password reset, end to end (spec §7.5).
 *
 * No provider, no domain and no API key: messages land in the development
 * mailbox, and these tests read it to follow the one-time links exactly as a
 * person would click them.
 */
const PASSWORD = 'a-good-enough-password';
const NEW_PASSWORD = 'an-even-better-password';

interface Mail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly locale: string;
  readonly links: readonly string[];
}

function unique(): { name: string; email: string } {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { name: `Mail_${tag}`.slice(0, 20), email: `mail_${tag}@example.test` };
}

async function mailbox(page: Page): Promise<readonly Mail[]> {
  const response = await page.request.get('/api/dev/mail');
  expect(response.ok(), 'the development mailbox answers outside production').toBe(true);
  return ((await response.json()) as { messages: Mail[] }).messages;
}

/**
 * Waits for the newest message matching `wanted`.
 *
 * The suite runs in parallel against one mailbox, so every lookup is filtered by
 * this test's own address rather than taking whatever arrived last.
 */
async function waitForMail(
  page: Page,
  wanted: (mail: Mail) => boolean,
  what: string,
): Promise<Mail> {
  let found: Mail | undefined;

  await expect
    .poll(
      async () => {
        found = (await mailbox(page)).find(wanted);
        return found !== undefined;
      },
      { timeout: 20_000, message: `no ${what} arrived` },
    )
    .toBe(true);

  return found as Mail;
}

function linkTo(mail: Mail, endpoint: string): string {
  const link = mail.links.find((url) => url.includes(endpoint));
  expect(link, `the message carries a ${endpoint} link`).toBeTruthy();
  return link as string;
}

async function register(page: Page, who: { name: string; email: string }): Promise<void> {
  await page.goto('/en/account');
  await page.getByRole('tab', { name: /create account/i }).click();
  await page.getByLabel(/display name/i).fill(who.name);
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 30_000 });
}

test('registering sends a confirmation email whose link confirms the address', async ({ page }) => {
  const who = unique();
  await register(page, who);

  const mail = await waitForMail(page, (m) => m.to === who.email, 'confirmation email');
  expect(mail.subject).toMatch(/confirm your email/i);
  expect(mail.locale).toBe('en');

  await page.goto(linkTo(mail, 'verify-email'));

  await expect(page.getByRole('heading', { level: 1, name: /email confirmed/i })).toBeVisible({
    timeout: 20_000,
  });
});

test('verification is optional: an unconfirmed account can play straight away', async ({
  page,
}) => {
  const who = unique();
  await register(page, who);

  // No link followed, no confirmation — and still a signed-in player who can
  // start a game. (The game screen has no site header, so the signed-in check
  // happens on the hub.)
  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 20_000 });

  await page.goto('/en/play/bot');
  await page.getByRole('button', { name: 'Auto-place' }).click();
  await page.getByRole('button', { name: 'Start the battle' }).click();
  await expect(page.getByRole('grid', { name: /enemy waters/i })).toBeVisible({ timeout: 20_000 });
});

test('a forgotten password can be reset, and the link works only once', async ({ page }) => {
  const who = unique();
  await register(page, who);
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible({ timeout: 20_000 });

  await page.goto('/en/account');
  await page.getByRole('button', { name: /forgotten your password/i }).click();
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByRole('button', { name: /send the link/i }).click();
  await expect(page.getByText(/a reset link is on its way/i)).toBeVisible();

  const mail = await waitForMail(
    page,
    (m) => m.to === who.email && /reset your password/i.test(m.subject),
    'reset email',
  );
  const link = linkTo(mail, 'reset-password');

  await page.goto(link);
  await page.getByLabel(/password/i).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: /save the new password/i }).click();
  await expect(page.getByText(/password changed/i)).toBeVisible({ timeout: 20_000 });

  // The new password works…
  await page.goto('/en/account');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible({ timeout: 20_000 });

  // …and the same link cannot be spent a second time. Scoped to the body: Next's
  // route announcer is also role="alert".
  await page.goto(link);
  const warning = page.getByRole('main').getByRole('alert');
  if (!(await warning.isVisible())) {
    await page.getByLabel(/password/i).fill('yet-another-password');
    await page.getByRole('button', { name: /save the new password/i }).click();
  }
  await expect(warning).toContainText(/expired or has already been used/i, { timeout: 20_000 });

  // And the old password did not survive the change.
  await page.goto('/en/account');
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(/do not match/i, {
    timeout: 20_000,
  });
});

test('asking to reset an unknown address says exactly the same thing', async ({ page }) => {
  const stranger = `nobody_${Date.now().toString(36)}@example.test`;

  await page.goto('/en/account');
  await page.getByRole('button', { name: /forgotten your password/i }).click();
  await page.getByLabel(/email/i).fill(stranger);
  await page.getByRole('button', { name: /send the link/i }).click();

  // The same confirmation a registered address gets — anything else would make
  // this page a way to find out who has an account.
  await expect(page.getByText(/a reset link is on its way/i)).toBeVisible();

  // Give a message time to show up if one were going to.
  await page.waitForTimeout(2_000);
  expect(
    (await mailbox(page)).filter((m) => m.to === stranger),
    'nothing is sent to an address with no account',
  ).toEqual([]);
});

test('the email is written in the language the player registered in', async ({ page }) => {
  const who = unique();

  await page.goto('/de/account');
  await page.getByRole('tab', { name: /konto erstellen/i }).click();
  await page.getByLabel(/anzeigename/i).fill(who.name);
  await page.getByLabel(/e-mail/i).fill(who.email);
  await page.getByLabel(/passwort/i).fill(PASSWORD);
  await page.getByRole('button', { name: /konto erstellen/i }).click();
  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 30_000 });

  const mail = await waitForMail(page, (m) => m.to === who.email, 'German confirmation email');
  expect(mail.locale).toBe('de');
  expect(mail.subject).toMatch(/bestätige deine e-mail-adresse/i);

  // And the link still lands on a German page.
  await page.goto(linkTo(mail, 'verify-email'));
  await expect(page).toHaveURL(/\/de\/account\/verified/, { timeout: 20_000 });
});

test('registering as a guest still carries the guest across', async ({ page }) => {
  /**
   * Sending a verification email must not have disturbed the claim. It rides on
   * sign-up issuing a session, which is exactly what requiring verification
   * before sign-in would have broken — so this is the regression guard for
   * leaving that requirement off.
   */
  await page.goto('/en/play/quick');
  const minted = await page.request.post('/api/auth/sign-in/anonymous', { data: {} });
  expect(minted.ok()).toBe(true);

  const who = unique();
  await register(page, who);

  await expect(page.getByRole('link', { name: who.name })).toBeVisible({ timeout: 20_000 });
  await waitForMail(page, (m) => m.to === who.email, 'confirmation email');
});
