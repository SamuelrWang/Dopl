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
 * The match is word-start and case-insensitive (`queryMatcher` uses the same
 * rule to decide which rows are hits at all), so a returned row always has
 * something marked, and what is marked is a word, never a stray letter.
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
 * Every apostrophe a person or a keyboard produces: ASCII, the two curly quotes
 * (macOS smart punctuation turns `can't` into `can’t`) and the modifier letter.
 * One class, used on BOTH sides, so `can't` finds `can’t` and the reverse.
 */
const APOSTROPHE_CLASS = "['\u2018\u2019\u02BC]";
const APOSTROPHES = /['\u2018\u2019\u02BC]/g;

/** A word character, for the boundary checks below. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * (2026-09-29) The query as the WORDS a person typed: apostrophes folded to one
 * spelling, surrounding quotation marks and a leading `-` stripped, split on
 * whitespace only. `or` is a word like any other: the tsquery builder ANDs it.
 *
 * ⚠ **AN APOSTROPHE IS PART OF THE WORD, NEVER A SEPARATOR.** The old
 * `replace(/["']/g, " ")` turned `can't` into the words `can` and `t`, and a
 * one-letter `t` then marked every `t` in every snippet (Samuel, 2026-09-29).
 */
export function queryWords(query: string): string[] {
  return query
    .replace(APOSTROPHES, "'")
    .replace(/["\u201C\u201D]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-+/, "").replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 0);
}

/**
 * The terms a snippet highlights: the whole query as a phrase, plus each word of
 * two or more characters.
 *
 * Whole query first, then longest words: the highlighter takes the first
 * alternative matching at a position, so `["ship","shipping"]` would mark only
 * `ship` and leave `ping` bare.
 * ⚠ A ONE-LETTER WORD IS NEVER ITS OWN TERM — it would mark letters, not words.
 * It is still highlighted inside the phrase term.
 */
export function highlightTerms(query: string): string[] {
  const words = queryWords(query.trim());
  if (words.length === 0) return [];
  const all = [words.join(" "), ...words.filter((w) => w.length >= 2)]
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

/**
 * One term as a regex SOURCE that matches it only at the START of a word:
 * `pick` matches *picker* but not *unpick*, and `t` can never match the `t` of
 * `can't`. Apostrophes match any spelling, runs of whitespace any run.
 *
 * The boundary is skipped when the term itself starts on punctuation (`#dev`,
 * `.env`) — there is no word for it to start.
 */
function termSource(term: string): string {
  const body = escapeRegExp(term)
    .replace(/'/g, APOSTROPHE_CLASS)
    .replace(/\s+/g, "\\s+");
  if (!WORD_CHAR.test(term.charAt(0))) return body;
  // Not after a word character, and not after an apostrophe that is itself
  // inside a word (`can|'t`) — but an opening quote (`'hello'`) still counts.
  return `(?<![\\p{L}\\p{N}_])(?<![\\p{L}\\p{N}]${APOSTROPHE_CLASS})${body}`;
}

/** Built once per search, never per row — a regex compiled inside a row loop
 *  turns a 50-row page into 50 compilations. */
export function highlightPattern(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  return new RegExp(terms.map(termSource).join("|"), "giu");
}

/**
 * (2026-09-29) Does a row actually say what was searched? Every typed word must
 * start a word somewhere in the row's text (case-insensitive, any apostrophe).
 *
 * The database arms are a CANDIDATE set, never the answer: an `ilike '%ca%'`
 * matches *scan* and a tsquery can only approximate a word with an apostrophe
 * in it. This is the one test every group's hits pass before they are ranked,
 * so a result with nothing to highlight cannot be returned.
 *
 * @returns `null` for a query with no words — the caller keeps what it has.
 */
export function queryMatcher(
  query: string
): ((texts: ReadonlyArray<string | null | undefined>) => boolean) | null {
  const words = queryWords(query.trim());
  if (words.length === 0) return null;
  const patterns = words.map(
    (w) => new RegExp(termSource(w.slice(0, MAX_TERM_LENGTH)), "iu")
  );
  return (texts) => {
    const haystack = texts.filter((t): t is string => !!t).join("\n");
    return patterns.every((p) => p.test(haystack));
  };
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
