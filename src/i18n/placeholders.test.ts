import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';

import deMessages from '../../messages/de.json';
import enMessages from '../../messages/en.json';
import esMessages from '../../messages/es.json';
import frMessages from '../../messages/fr.json';
import itMessages from '../../messages/it.json';
import { locales, type Locale } from './routing';

/**
 * Every translation must be valid ICU and must use exactly the placeholders the
 * English source does (spec §7.14).
 *
 * The arguments are *parsed*, not pattern-matched: a plural branch like
 * `{No ships remaining}` looks like a placeholder to a regular expression and is
 * not one, and getting that wrong either hides real breakage or buries the real
 * failures in noise.
 *
 * A missing placeholder prints an empty hole; an invented one throws at render
 * time. Both are the kind of fault that only shows up in the one language nobody
 * on the team reads, which is exactly why it is a test.
 */
type Tree = { [key: string]: string | Tree };

const catalogs: Record<Locale, Tree> = {
  en: enMessages as Tree,
  de: deMessages as Tree,
  es: esMessages as Tree,
  it: itMessages as Tree,
  fr: frMessages as Tree,
};

function flatten(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? ([[path, value]] as [string, string][])
      : flatten(value, path);
  });
}

/** Argument names an ICU message actually reads, branch bodies excluded. */
function argumentsOf(message: string): Set<string> {
  const found = new Set<string>();

  const walk = (nodes: MessageFormatElement[]): void => {
    for (const node of nodes) {
      // A literal's `value` is its text and a pound's is nothing; both are
      // narrowed out by the time `value` is a string on an argument-bearing node.
      if ('value' in node && typeof node.value === 'string' && node.type !== TYPE.literal) {
        found.add(node.value);
      }
      if ('options' in node && node.options) {
        for (const option of Object.values(node.options)) {
          walk(option.value);
        }
      }
      if (node.type === TYPE.tag) {
        walk(node.children);
      }
    }
  };

  walk(parse(message));
  return found;
}

/** Rich-text tags, e.g. the `<time>` the disconnect countdown is rendered into. */
function tagsOf(message: string): Set<string> {
  const found = new Set<string>();

  const walk = (nodes: MessageFormatElement[]): void => {
    for (const node of nodes) {
      if (node.type === TYPE.tag) {
        found.add(node.value);
        walk(node.children);
      }
      if ('options' in node && node.options) {
        for (const option of Object.values(node.options)) {
          walk(option.value);
        }
      }
    }
  };

  walk(parse(message));
  return found;
}

const english = new Map(flatten(catalogs.en));
const translated = locales.filter((locale) => locale !== 'en');

describe('every message is valid ICU', () => {
  it.each(locales)('%s parses', (locale) => {
    const broken: string[] = [];

    for (const [key, message] of flatten(catalogs[locale])) {
      try {
        parse(message);
      } catch (error) {
        broken.push(`${key}: ${(error as Error).message}`);
      }
    }

    expect(broken).toEqual([]);
  });
});

describe('translations keep the placeholders they were given', () => {
  it.each(translated)('%s uses exactly the English arguments', (locale) => {
    const wrong: string[] = [];

    for (const [key, message] of flatten(catalogs[locale])) {
      const source = english.get(key);
      if (source === undefined) {
        continue; // Covered by messages.test.ts, which rejects orphan keys.
      }

      const expected = [...argumentsOf(source)].sort();
      const actual = [...argumentsOf(message)].sort();
      if (expected.join() !== actual.join()) {
        wrong.push(`${key}: expected [${expected}], got [${actual}]`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it.each(translated)('%s keeps the same rich-text tags', (locale) => {
    const wrong: string[] = [];

    for (const [key, message] of flatten(catalogs[locale])) {
      const source = english.get(key);
      if (source === undefined) {
        continue;
      }

      const expected = [...tagsOf(source)].sort();
      const actual = [...tagsOf(message)].sort();
      if (expected.join() !== actual.join()) {
        wrong.push(`${key}: expected <${expected}>, got <${actual}>`);
      }
    }

    expect(wrong).toEqual([]);
  });
});

describe('translation coverage (spec §7.14)', () => {
  it.each(locales)('%s is complete', (locale) => {
    // A locale may ship partially translated and fall back to English, so this is
    // a statement about where the project has got to, not about what is allowed.
    const have = new Set(flatten(catalogs[locale]).map(([key]) => key));
    const missing = [...english.keys()].filter((key) => !have.has(key));

    expect(missing).toEqual([]);
  });
});
