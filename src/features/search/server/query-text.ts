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

/** `…q…` — the popup's matcher. The leading `%` means no b-tree index can serve
 *  it, so every read using it is bounded by a fence plus a `limit`. */
export function containsPattern(query: string): string {
  return `%${escapeLikeLiteral(query)}%`;
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
 * splits `a_b` into a phrase match, not a syntax error.
 *
 * @returns `null` when the query has no token at all, signalling the caller to run
 * NO full-text query rather than one matching everything.
 */
export function buildPrefixTsQuery(query: string): string | null {
  const tokens = query
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length > 0)
    .slice(0, MAX_TSQUERY_TOKENS);
  if (tokens.length === 0) return null;
  return tokens
    .map((token, i) => (i === tokens.length - 1 ? `${token}:*` : token))
    .join(" & ");
}
