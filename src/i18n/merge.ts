type MessageTree = { [key: string]: string | MessageTree };

function isTree(value: unknown): value is MessageTree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges a locale catalog over the English one so any key missing from a
 * partially-translated locale resolves to its English string instead of throwing.
 *
 * Spec §7.14: "A locale can be partially translated and still shipped because
 * missing keys fall back to EN."
 */
export function mergeWithFallback(fallback: MessageTree, override: MessageTree): MessageTree {
  const result: MessageTree = { ...fallback };

  for (const [key, value] of Object.entries(override)) {
    const base = result[key];

    if (isTree(value) && isTree(base)) {
      result[key] = mergeWithFallback(base, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

export type { MessageTree };
