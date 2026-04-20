/**
 * Tag normalization — one place. Historically skeleton ingest lowercased
 * tag_value inline while agent-driven full ingest stored whatever the
 * agent produced (mixed case, stray whitespace). Same URL through two
 * paths could produce two different tag values ('Claude' vs 'claude'),
 * and any tag filter downstream would miss half the entries.
 *
 * Both ingest paths call through here now.
 */

export interface TagLike {
  tag_type: string;
  tag_value: string;
}

/**
 * Lowercase + trim both fields; collapse internal whitespace in tag_value.
 * Returns null if either field is empty after normalization — the caller
 * should skip these rather than insert garbage.
 */
export function normalizeTag(t: TagLike): TagLike | null {
  const tag_type = t.tag_type?.trim().toLowerCase() ?? "";
  const tag_value = t.tag_value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  if (!tag_type || !tag_value) return null;
  return { tag_type, tag_value };
}

/**
 * Map an array of tags through normalizeTag and drop any that collapse
 * to null. Handy wrapper for the common call pattern.
 */
export function normalizeTags(tags: TagLike[]): TagLike[] {
  const out: TagLike[] = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (n) out.push(n);
  }
  return out;
}
