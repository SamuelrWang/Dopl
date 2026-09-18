import "server-only";

/**
 * The one place `SearchItem.snippet` is minted, and the one place a `<mark>` tag
 * enters this feature.
 *
 * Not `ts_headline`, and that is a security choice: it copies the source through
 * verbatim, so a body containing `<script>` would come back as `<script>` into a
 * payload the popup renders with `innerHTML`. Building it here escapes FIRST and
 * inserts markup SECOND, the only order in which the contract holds. (Secondly,
 * PostgREST cannot ask for a SELECT-list expression at all.)
 *
 * The match is substring and case-insensitive, deliberately wider than the
 * `tsquery` that selected the row: the row is already a hit and this only decides
 * where to point. A narrower highlighter would return a hit with nothing marked.
 */

/** Characters that would change the shape of the HTML around them. */
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** `&` first by construction — a single pass over one character class, so an
 *  escaped `&lt;` can never be re-escaped into `&amp;lt;`. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

/** How much text rides on the wire per hit. The body is truncated in the SERVICE,
 *  never in the renderer (INVARIANTS §9). */
export const SNIPPET_CHARS = 180;

/** Characters kept before the first match, so the hit is not flush-left. */
const LEAD_CHARS = 40;

/** The longest term we will scan for. Bounds the regex the query builds. */
const MAX_TERM_LENGTH = 64;

/**
 * The terms a snippet highlights: the whole trimmed query, plus each
 * whitespace-separated word.
 *
 * Whole query first, then longest words: the highlighter takes the first
 * alternative matching at a position, so `["ship","shipping"]` would mark only
 * `ship` and leave `ping` bare.
 * Quotation marks and the `websearch_to_tsquery` operators are stripped — they
 * steer which ROWS come back, and are not text to point at inside one.
 */
export function highlightTerms(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const cleaned = trimmed.replace(/["']/g, " ").trim();
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^-+/, ""))
    .filter((w) => w.length > 0 && w.toLowerCase() !== "or");
  // Built from the cleaned words, not the raw query: `cats or dogs` hunted
  // verbatim could mark a literal "or" somebody wrote.
  const all = [words.join(" "), ...words]
    .filter((t) => t.length > 0)
    .map((t) => t.slice(0, MAX_TERM_LENGTH));
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const term of all) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(term);
  }
  return unique.sort((a, b) => b.length - a.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Built once per search, never per row — a regex compiled inside a row loop
 *  turns a 50-row page into 50 compilations. */
export function highlightPattern(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  return new RegExp(terms.map(escapeRegExp).join("|"), "gi");
}

/**
 * Plain text to a bounded, escaped, `<mark>`-highlighted excerpt.
 *
 * An ellipsis is not a clip notice — the §9 "this read was clipped" signal is
 * `SearchGroup.total`, and the two must never be confused.
 * Returns `undefined`, never `""`, so an absent snippet reads as "this kind has
 * no body" rather than "the body is blank".
 */
export function buildSnippet(
  body: string | null | undefined,
  pattern: RegExp | null
): string | undefined {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return undefined;

  let start = 0;
  if (pattern) {
    // `lastIndex` is reset on every call: a `g` regex reused across rows resumes
    // where the previous row ended and silently misses early matches.
    pattern.lastIndex = 0;
    const hit = pattern.exec(text);
    if (hit && hit.index > LEAD_CHARS) start = hit.index - LEAD_CHARS;
  }
  const window = text.slice(start, start + SNIPPET_CHARS);
  const prefix = start > 0 ? "…" : "";
  const suffix = start + SNIPPET_CHARS < text.length ? "…" : "";

  if (!pattern) return `${prefix}${escapeHtml(window)}${suffix}`;

  // Match on the RAW text, escape every piece, emit `<mark>` last. Matching on
  // already-escaped text fails both ways: `A&B` would never match `A&amp;B`, and
  // a replace over escaped text cannot tell an inserted mark from one the body
  // contained. The only unescaped characters emitted are the tags below.
  const parts: string[] = [];
  let last = 0;
  pattern.lastIndex = 0;
  for (
    let hit = pattern.exec(window);
    hit !== null;
    hit = pattern.exec(window)
  ) {
    // A zero-length match would spin forever — step past it.
    if (hit[0].length === 0) {
      pattern.lastIndex += 1;
      continue;
    }
    parts.push(escapeHtml(window.slice(last, hit.index)));
    parts.push(`<mark>${escapeHtml(hit[0])}</mark>`);
    last = hit.index + hit[0].length;
  }
  parts.push(escapeHtml(window.slice(last)));
  return `${prefix}${parts.join("")}${suffix}`;
}
