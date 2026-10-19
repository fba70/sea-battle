/**
 * The reactions a player may send (spec §7.4: "a small fixed set of reactions
 * relayed through the session to the opponent (no free text in v1 →
 * moderation-free)").
 *
 * Six, chosen to cover what a duel actually produces — applause, surprise,
 * laughter, a streak, despair, and a salute for "good game" — and deliberately
 * nothing that reads as a taunt, because the recipient has no words to answer with.
 *
 * Fixed and tiny on purpose. The set is the whole vocabulary: it needs no
 * moderation, and spec §7.14 notes that emoji are locale-agnostic, so none of this
 * is translated. Only the accessible labels are.
 */
export const REACTIONS = ['👏', '😮', '😂', '🔥', '😭', '🫡'] as const;

export type Reaction = (typeof REACTIONS)[number];

/** Stable keys for the accessible labels, since an emoji is a poor message key. */
export const REACTION_LABEL_KEYS: Readonly<Record<Reaction, string>> = {
  '👏': 'applause',
  '😮': 'surprise',
  '😂': 'laugh',
  '🔥': 'fire',
  '😭': 'sob',
  '🫡': 'salute',
};

export function isReaction(value: string): value is Reaction {
  return (REACTIONS as readonly string[]).includes(value);
}

/**
 * Spam limits (spec §10: the server owns this).
 *
 * A token bucket rather than a flat cooldown: a burst of three is natural — you
 * react to a volley — while the sustained rate stays at one every two seconds.
 */
export const REACTION_BURST = 3;
export const REACTION_REFILL_MS = 2_000;
