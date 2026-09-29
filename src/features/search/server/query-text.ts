import "server-only";

/**
 * The one place a caller-supplied string becomes a PostgREST filter value in this
 * feature.
 *
 * `escapeLikeLiteral` is a deliberate fourth copy: the other three build an EXACT
 * `ilike` over one row and this builds a CONTAINS pattern over a page, and a
 * shared helper between callers whose patterns differ is how one inherits the
 * wrong wildcard.
 */

/** `%`, `_` and `\` are literals in what somebody typed. Unescaped, a query of
 *  `100%` matches `100x` and a query of `a_b` matches `axb`. */
export function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Every apostrophe a person or a keyboard produces: ASCII, the two curly quotes
 * (macOS smart punctuation turns `can't` into `can’t`) and the modifier letter.
 * One class, used on BOTH sides (here and `snippet.ts`), so `can't` finds
 * `can’t` and the reverse.
 */
export const APOSTROPHE_CLASS = "['\u2018\u2019\u02BC]";
export const APOSTROPHES = new RegExp(APOSTROPHE_CLASS, "g");

/** `…q…` — the popup's CANDIDATE matcher. The leading `%` means no b-tree index
 *  can serve it, so every read using it is bounded by a fence plus a `limit`.
 *
 *  (2026-09-29) An apostrophe becomes `_` (one character, any character) so
 *  `can't` also reaches a title spelled `can’t`; `snippet.ts › queryMatcher`
 *  then drops every candidate that does not actually say the word. */
export function containsPattern(query: string): string {
  return `%${escapeLikeLiteral(query).replace(APOSTROPHES, "_")}%`;
}

/** `q…` — a PREFIX match, used for `profiles.email` alone. An address is not
 *  prose and a contains-match on one turns every `@gmail.com` into a hit. */
export function prefixPattern(query: string): string {
  return `${escapeLikeLiteral(query)}%`;
}

/**
 * A value going into a raw `.or()` filter string, quoted.
 *
 * `.or()` takes a filter STRING PostgREST parses: `,` splits arms, `.` splits
 * column-operator-value, `)` closes a group. Here the value is free text from a
 * search box, so an unquoted arm would let `a,b.eq.c` rewrite the query's shape —
 * inside a tenancy fence.
 */
export function orLiteral(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * The dictionary, named on the query side of every `@@` in this feature. Not
 * optional (F-717): PostgREST's `config` parameterises the tsquery FUNCTION, not
 * the column, so omitting it falls back to the server's
 * `default_text_search_config` (english here) against a `simple` vector and
 * silently matches almost nothing. A word that does not stem (`picker`) matches
 * under both, which is how a one-word probe hides the bug.
 */
export const SEARCH_TSQUERY_CONFIG = "simple";

/** A bound on the `tsquery`, not on the answer: every extra token is another `&`
 *  arm Postgres must intersect, and a pasted paragraph is not a search. */
export const MAX_TSQUERY_TOKENS = 8;

/**
 * A typed string to a `to_tsquery` expression whose LAST token is a prefix.
 *
 * The prefix is why this builder exists: `websearch_to_tsquery` matches whole
 * lexemes, so `pick` could never find *picker* in a popup typed one character at
 * a time. Only the last token is prefixed — earlier ones are finished words.
 *
 * It cannot be `type:"plain"` or `"websearch"`: both normalise the `:*` away.
 * The raw form is `to_tsquery`, the only one that honours it and the only one
 * that can raise a syntax error on user text — hence the sanitiser.
 *
 * The sanitiser is an ALLOW-LIST over `\p{L}\p{N}_`, not an escape pass: `&`,
 * `|`, `!`, `<->`, `(`, `)`, `'` and `:` are all operators, and a blocklist that
 * missed one turns the search box into a tsquery editor. `_` is safe — the parser
 * splits `a_b` into a phrase match, not a syntax error. The only operators in
 * the output are the ones written here: `&`, `<->` and `:*`.
 *
 * ⚠ **(2026-09-29) AN APOSTROPHE JOINS, IT DOES NOT SPLIT.** Postgres's parser
 * reads `can't` (and `can’t`) as two ADJACENT lexemes, `can` then `t`. ANDing
 * them (`can & t:*`, "ANY word starting with *t* anywhere") matches nearly every
 * message (Samuel, 2026-09-29); the phrase `can <-> t:*` is what the text
 * contains. `snippet.ts › queryMatcher` then holds every candidate to
 * the literal word, so `can <-> t:*` reaching *can take* is dropped.
 *
 * @returns `null` when the query has no token at all, signalling the caller to run
 * NO full-text query rather than one matching everything.
 */
export function buildPrefixTsQuery(query: string): string | null {
  // Tokens joined by apostrophes inside one typed word form a phrase group
  // (`<->`); groups are ANDed.
  const groups: string[][] = [];
  let count = 0;
  const pieces = query.replace(APOSTROPHES, "'").split(/[^\p{L}\p{N}_']+/u);
  for (const piece of pieces) {
    if (count >= MAX_TSQUERY_TOKENS) break;
    const tokens = piece
      .split(/'+/)
      .filter((token) => token.length > 0)
      .slice(0, MAX_TSQUERY_TOKENS - count);
    if (tokens.length === 0) continue;
    groups.push(tokens);
    count += tokens.length;
  }
  if (groups.length === 0) return null;
  const last = groups.length - 1;
  return groups
    .map((tokens, g) =>
      tokens
        .map((token, i) =>
          g === last && i === tokens.length - 1 ? `${token}:*` : token
        )
        .join(" <-> ")
    )
    .join(" & ");
}
