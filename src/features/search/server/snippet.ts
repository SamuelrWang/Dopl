import "server-only";

/**
 * THE SNIPPET — the ONE place `SearchItem.snippet` is minted, and the one place
 * a `<mark>` tag enters this feature.
 *
 * 🔒 ⚠ **IT IS NOT `ts_headline`, AND THAT IS A SECURITY CHOICE RATHER THAN A
 * PORTING SHORTCUT (2026-09-17).** `ts_headline` COPIES THE SOURCE THROUGH
 * VERBATIM between its delimiters: a message body containing `<script>` comes
 * back as `<script>`, so a payload documented as *"plain text, match highlighted
 * with `<mark>…</mark>` only, no other HTML"* would be a lie the moment somebody
 * posted a tag, and the popup renders these with `innerHTML`. Building the
 * snippet here lets the ESCAPE happen FIRST and the markup be inserted SECOND,
 * which is the only order in which the contract's sentence is true.
 * ⚠ The second reason is availability: `ts_headline` and `ts_rank` are
 * expressions in a SELECT list, and PostgREST has no way to ask for one — they
 * would need a `SECURITY DEFINER` RPC, i.e. a route that is BROKEN rather than
 * SLOW until its migration is applied (`20260822170000_overview_time_range_
 * indexes.sql` states that rule).
 *
 * ⚠ **THE MATCH IS SUBSTRING AND CASE-INSENSITIVE, WHICH IS DELIBERATELY WIDER
 * THAN THE `tsquery` THAT SELECTED THE ROW.** The row is already a hit; this only
 * decides where to point. A narrower highlighter would hand back a hit with
 * nothing marked in it, which reads as a false positive.
 */

/** Characters that would change the shape of the HTML around them. */
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** ⚠ `&` FIRST BY CONSTRUCTION — a single pass over one character class, so an
 *  escaped `&lt;` can never be re-escaped into `&amp;lt;`. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] as string);
}

/** How much text rides on the wire per hit. ⚠ The body is truncated in the
 *  SERVICE, never in the renderer (INVARIANTS §9). */
export const SNIPPET_CHARS = 180;

/** Characters kept before the first match, so the hit is not flush-left. */
const LEAD_CHARS = 40;

/** The longest term we will scan for. Bounds the regex the query builds. */
const MAX_TERM_LENGTH = 64;

/**
 * The terms a snippet highlights: the whole trimmed query, plus each
 * whitespace-separated word of it.
 *
 * ⚠ **THE WHOLE QUERY COMES FIRST AND THE LONGEST WORDS NEXT**, because the
 * highlighter takes the first alternative that matches at a position: with
 * `["ship", "shipping"]` a search for `shipping` would mark only `ship` and
 * leave `ping` bare.
 * ⚠ Quotation marks and the `websearch_to_tsquery` operators (`or`, `-`) are
 * STRIPPED rather than honoured — they steer which ROWS come back; inside a row
 * they are not text the reader typed at the thing they are looking at.
 */
export function highlightTerms(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const cleaned = trimmed.replace(/["']/g, " ").trim();
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^-+/, ""))
    .filter((w) => w.length > 0 && w.toLowerCase() !== "or");
  // ⚠ THE PHRASE IS BUILT FROM THE CLEANED WORDS, NOT FROM THE RAW QUERY. A raw
  // `cats or dogs` would otherwise be hunted verbatim and could mark a literal
  // "or" somebody wrote — the operators steer which ROWS come back and are not
  // text the reader is pointing at.
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

/** ⚠ Built ONCE per search, never per row: a regex compiled inside a row loop is
 *  the shape that turns a 50-row page into 50 compilations. */
export function highlightPattern(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  return new RegExp(terms.map(escapeRegExp).join("|"), "gi");
}

/**
 * Plain text → a bounded, escaped, `<mark>`-highlighted excerpt.
 *
 * ⚠ **AN ELLIPSIS IS NOT A CLIP NOTICE.** It says the excerpt is a window onto a
 * longer body, which the caller already knows; the §9 "this read was clipped"
 * signal is `SearchGroup.total`, and these two must never be confused.
 * ⚠ Returns `undefined` — never `""` — for a body with nothing in it, so an
 * absent snippet reads as "this kind has no body" rather than "the body is
 * blank".
 */
export function buildSnippet(
  body: string | null | undefined,
  pattern: RegExp | null
): string | undefined {
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return undefined;

  let start = 0;
  if (pattern) {
    // ⚠ `lastIndex` is RESET on every call: a `g` regex reused across rows
    // resumes where the previous row ended and silently misses early matches.
    pattern.lastIndex = 0;
    const hit = pattern.exec(text);
    if (hit && hit.index > LEAD_CHARS) start = hit.index - LEAD_CHARS;
  }
  const window = text.slice(start, start + SNIPPET_CHARS);
  const prefix = start > 0 ? "…" : "";
  const suffix = start + SNIPPET_CHARS < text.length ? "…" : "";

  if (!pattern) return `${prefix}${escapeHtml(window)}${suffix}`;

  // 🔒 **MATCH ON THE RAW TEXT, ESCAPE EVERY PIECE, AND EMIT `<mark>` LAST.**
  // Matching on already-escaped text is the obvious shortcut and it is WRONG in
  // both directions: a query containing `&` or `<` would never match its own
  // body (`A&B` against `A&amp;B`), and an `.replace()` over escaped text cannot
  // tell a mark it inserted from one the body contained. So the only unescaped
  // characters this function can emit are the tags on the two lines below.
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
