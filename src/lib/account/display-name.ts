/**
 * Display-name rules (spec §7.5's "minimal profile: display name").
 *
 * Pure: no database, no framework. The same rules run in three places — the sign-up
 * form as you type, the server before it writes a row, and a unique index in Postgres
 * — and only the last of those can actually arbitrate a race. The first two exist to
 * give a person a sensible message instead of a constraint violation.
 *
 * Agreed product rules: 3–20 characters, letters, numbers and underscores, unique
 * case-insensitively.
 */

export const DISPLAY_NAME_MIN_LENGTH = 3;
export const DISPLAY_NAME_MAX_LENGTH = 20;

/** Letters, digits and underscore. No spaces, no punctuation, no emoji. */
const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * Names nobody may register.
 *
 * Every guest is called "Anonymous", so a registered player holding that name would
 * read as a guest everywhere it appears — on the leaderboard, in a match history, in
 * the result screen. The rest are the usual impersonation risks.
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'anonymous',
  'guest',
  'admin',
  'administrator',
  'moderator',
  'support',
  'system',
  'seaduel',
]);

export type DisplayNameProblem =
  'too_short' | 'too_long' | 'invalid_characters' | 'reserved' | 'taken';

export type DisplayNameCheck =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly problem: DisplayNameProblem };

/** Surrounding whitespace is a typo, not a decision; everything else is kept. */
export function normaliseDisplayName(raw: string): string {
  return raw.trim();
}

/** The form used for uniqueness: names differing only in case are the same name. */
export function displayNameKey(raw: string): string {
  return normaliseDisplayName(raw).toLowerCase();
}

/** Checks everything except whether somebody already has it. */
export function checkDisplayName(raw: string): DisplayNameCheck {
  const name = normaliseDisplayName(raw);

  if (name.length < DISPLAY_NAME_MIN_LENGTH) {
    return { ok: false, problem: 'too_short' };
  }
  if (name.length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, problem: 'too_long' };
  }
  if (!DISPLAY_NAME_PATTERN.test(name)) {
    return { ok: false, problem: 'invalid_characters' };
  }
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    return { ok: false, problem: 'reserved' };
  }

  return { ok: true, name };
}

/** Nautical enough to suit the game, plain enough to be worth keeping. */
const SUGGESTION_WORDS: readonly string[] = [
  'Skipper',
  'Captain',
  'Helm',
  'Anchor',
  'Harbour',
  'Compass',
  'Beacon',
  'Mariner',
  'Tide',
  'Keel',
  'Rudder',
  'Lookout',
];

/**
 * A name to offer in the sign-up form, which the person can keep or replace.
 *
 * Takes its randomness as an argument so a test can pin it. Always satisfies
 * `checkDisplayName`: the words are short, the suffix is four digits, and the
 * longest combination is well inside twenty characters.
 */
export function suggestDisplayName(random: () => number = Math.random): string {
  const word = SUGGESTION_WORDS[Math.floor(random() * SUGGESTION_WORDS.length)] as string;
  // 1000–9999, so the suffix never has a leading zero and is always four digits.
  const suffix = 1000 + Math.floor(random() * 9000);
  return `${word}_${suffix}`;
}
