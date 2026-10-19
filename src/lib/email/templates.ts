import { createTranslator } from 'next-intl';

import deMessages from '../../../messages/de.json';
import enMessages from '../../../messages/en.json';
import esMessages from '../../../messages/es.json';
import frMessages from '../../../messages/fr.json';
import itMessages from '../../../messages/it.json';
import { mergeWithFallback, type MessageTree } from '@/i18n/merge';
import { defaultLocale, type Locale } from '@/i18n/routing';

import type { EmailMessage } from './message';

/**
 * The two emails SeaDuel sends, in the recipient's language (spec §7.14:
 * "transactional emails … rendered in the recipient's `users.locale`").
 *
 * The catalogs are loaded directly rather than through next-intl's request
 * context: these are rendered inside better-auth's callbacks, which are not a
 * React render and have no request scope to borrow a translator from. The same
 * English fallback applies, so a key missing from one language still sends.
 *
 * Plain text first. These messages exist to carry one link; a text part that
 * reads properly matters more than styling, and it is what a mail client shows
 * when it refuses the HTML.
 */

const catalogs: Record<Locale, MessageTree> = {
  en: enMessages as MessageTree,
  de: deMessages as MessageTree,
  es: esMessages as MessageTree,
  it: itMessages as MessageTree,
  fr: frMessages as MessageTree,
};

function translator(locale: Locale) {
  const messages = mergeWithFallback(catalogs[defaultLocale], catalogs[locale]);
  return createTranslator({ locale, messages: messages as unknown as typeof enMessages });
}

/** Minimal, inline-styled, and readable in both light and dark mail clients. */
function wrap(title: string, body: readonly string[], action: { label: string; url: string }) {
  const paragraphs = body
    .map((line) => `<p style="margin:0 0 16px;line-height:1.6">${escape(line)}</p>`)
    .join('');

  return `<!doctype html>
<html><body style="margin:0;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;background:#f8fafc">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
<h1 style="margin:0 0 16px;font-size:20px">${escape(title)}</h1>
${paragraphs}
<p style="margin:24px 0"><a href="${escape(action.url)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none">${escape(action.label)}</a></p>
<p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">${escape(action.url)}</p>
</div></body></html>`;
}

/** The URL is attacker-influenced only through our own auth layer, but escape anyway. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plain(title: string, body: readonly string[], action: { label: string; url: string }) {
  return [title, '', ...body, '', `${action.label}: ${action.url}`, ''].join('\n');
}

export function verificationEmail(input: {
  to: string;
  url: string;
  locale: Locale;
}): EmailMessage {
  const t = translator(input.locale);
  const title = t('email.verify.subject');
  const body = [t('email.verify.body'), t('email.verify.ignore')];
  const action = { label: t('email.verify.action'), url: input.url };

  return {
    to: input.to,
    subject: title,
    text: plain(title, body, action),
    html: wrap(title, body, action),
    locale: input.locale,
  };
}

export function passwordResetEmail(input: {
  to: string;
  url: string;
  locale: Locale;
  expiresInMinutes: number;
}): EmailMessage {
  const t = translator(input.locale);
  const title = t('email.reset.subject');
  const body = [
    t('email.reset.body', { minutes: input.expiresInMinutes }),
    t('email.reset.ignore'),
  ];
  const action = { label: t('email.reset.action'), url: input.url };

  return {
    to: input.to,
    subject: title,
    text: plain(title, body, action),
    html: wrap(title, body, action),
    locale: input.locale,
  };
}
