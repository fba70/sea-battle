import { beforeEach, describe, expect, it } from 'vitest';

import { localeForEmail } from '../email-locale';
import { clearOutbox, createDevOutbox, readOutbox } from './outbox';
import { sendEmail, setEmailTransport } from './send';
import { unconfiguredTransport } from './message';
import { passwordResetEmail, verificationEmail } from './templates';
import { locales, routing } from '@/i18n/routing';

beforeEach(() => {
  clearOutbox();
  setEmailTransport(null);
});

describe('the two messages SeaDuel sends', () => {
  const url = 'http://localhost:3000/api/auth/verify-email?token=abc123';

  it('renders a verification email in every language', () => {
    for (const locale of locales) {
      const message = verificationEmail({ to: 'player@example.test', url, locale });

      expect(message.subject.length, locale).toBeGreaterThan(0);
      expect(message.text, locale).toContain(url);
      expect(message.html, locale).toContain(url);
      expect(message.locale).toBe(locale);
    }
  });

  it('renders a reset email in every language, saying how long the link lasts', () => {
    for (const locale of locales) {
      const message = passwordResetEmail({
        to: 'player@example.test',
        url,
        locale,
        expiresInMinutes: 60,
      });

      expect(message.text, locale).toContain('60');
      expect(message.text, locale).toContain(url);
    }
  });

  it('says something different in each language', () => {
    // A catalog that silently fell back to English everywhere would still pass
    // the checks above; this is what proves the translations are being used.
    const subjects = locales.map(
      (locale) => verificationEmail({ to: 'a@b.test', url, locale }).subject,
    );

    expect(new Set(subjects).size).toBe(locales.length);
  });

  it('escapes the HTML part rather than interpolating raw', () => {
    const message = verificationEmail({
      to: 'a@b.test',
      url: 'http://localhost/x?a=1&b="><script>alert(1)</script>',
      locale: 'en',
    });

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  it('carries a plain-text part that stands on its own', () => {
    const message = passwordResetEmail({
      to: 'a@b.test',
      url,
      locale: 'en',
      expiresInMinutes: 60,
    });

    expect(message.text).not.toContain('<');
    expect(message.text.split('\n').length).toBeGreaterThan(3);
  });
});

describe('the development outbox', () => {
  it('keeps what was sent, newest first', async () => {
    setEmailTransport(createDevOutbox());

    await sendEmail(verificationEmail({ to: 'one@example.test', url: 'http://x/1', locale: 'en' }));
    await sendEmail(verificationEmail({ to: 'two@example.test', url: 'http://x/2', locale: 'en' }));

    const outbox = readOutbox();
    expect(outbox.map((message) => message.to)).toEqual(['two@example.test', 'one@example.test']);
  });

  it('pulls the links out, so a test can follow one without parsing', async () => {
    setEmailTransport(createDevOutbox());
    const url = 'http://localhost:3000/api/auth/verify-email?token=abc';

    await sendEmail(verificationEmail({ to: 'a@b.test', url, locale: 'en' }));

    expect(readOutbox()[0]?.links).toContain(url);
  });

  it('can be emptied, so one test cannot read another’s message', async () => {
    setEmailTransport(createDevOutbox());
    await sendEmail(verificationEmail({ to: 'a@b.test', url: 'http://x', locale: 'en' }));

    clearOutbox();
    expect(readOutbox()).toEqual([]);
  });
});

describe('sending', () => {
  it('reports failure instead of throwing, so a sign-up is never lost to it', async () => {
    setEmailTransport(unconfiguredTransport);

    const sent = await sendEmail(
      verificationEmail({ to: 'a@b.test', url: 'http://x', locale: 'en' }),
    );

    expect(sent).toBe(false);
  });

  it('refuses to pretend when no provider is configured', () => {
    // Silently dropping a password reset is worse than failing: the person would
    // wait for an email that was never going anywhere.
    expect(() => unconfiguredTransport.send({} as never)).toThrow(/no email provider/i);
  });
});

describe('which language someone is written to in (spec §7.14)', () => {
  /**
   * The name next-intl is configured to write. Pinned, because an earlier version
   * of this read the library's default name instead and so never found the
   * cookie: every email went out in English.
   */
  const COOKIE =
    typeof routing.localeCookie === 'object' ? routing.localeCookie.name : 'NEXT_LOCALE';

  it('reads the cookie the app actually sets', () => {
    expect(COOKIE).toBe('SEADUEL_LOCALE');
  });

  it('uses the language saved on the account', () => {
    expect(localeForEmail({ locale: 'it' })).toBe('it');
  });

  it('falls back to the language the request was made in', () => {
    const request = new Request('https://seaduel.test', {
      headers: { cookie: `${COOKIE}=fr; other=1` },
    });

    // A brand-new account has no saved preference yet: they are registering in
    // whatever language they are reading.
    expect(localeForEmail({ locale: null }, request)).toBe('fr');
  });

  it('prefers the account over the cookie', () => {
    const request = new Request('https://seaduel.test', {
      headers: { cookie: `${COOKIE}=fr` },
    });

    expect(localeForEmail({ locale: 'de' }, request)).toBe('de');
  });

  it('falls back to English rather than trusting a strange value', () => {
    const request = new Request('https://seaduel.test', {
      headers: { cookie: `${COOKIE}=ru` },
    });

    expect(localeForEmail({ locale: 'klingon' }, request)).toBe('en');
    expect(localeForEmail({})).toBe('en');
  });
});
