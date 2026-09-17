import "server-only";

/**
 * THE TEXT A SEARCH PUTS INTO A QUERY — the one place a caller-supplied string
 * is turned into a PostgREST filter value in this feature.
 *
 * ⚠ **IT IS A DELIBERATE FOURTH COPY OF `escapeLikeLiteral`**, beside
 * `shared/tenancy/resolve-resource.ts`, `channels/server/repository.ts ›
 * findChannelBySlug` and `chats/server/repository.ts › findFolderByName`. The
 * rule it encodes is the same; the SHAPE around it is not — those three build an
 * EXACT `ilike` over one row and this one builds a CONTAINS pattern over a page
 * — and a shared helper between four callers whose patterns differ is how one of
 * them inherits the wrong wildcard. That trade is `repository-account.ts ›
 * excludeAuthorFilter`'s, made a second time.
 */

/** `%`, `_` and `\` are LITERALS in what somebody typed. Unescaped, a query of
 *  `100%` matches `100x` and a query of `a_b` matches `axb`. */
export function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** `…q…` — the popup's matcher. ⚠ Leading `%` means no b-tree index can serve
 *  it; the reads that use it are all bounded by a fence + a `limit`. */
export function containsPattern(query: string): string {
  return `%${escapeLikeLiteral(query)}%`;
}

/** `q…` — a PREFIX match, used for `profiles.email` alone. An address is not
 *  prose and a contains-match on one turns every `@gmail.com` into a hit. */
export function prefixPattern(query: string): string {
  return `${escapeLikeLiteral(query)}%`;
}

/**
 * A value going into a RAW `.or()` filter string, quoted —
 * `shared/tenancy/resolve-resource.ts › orLiteral`'s rule, restated because
 * that one is not exported.
 *
 * 🔒 ⚠ **THIS IS THE ONE THAT BITES HERE, AND IT BITES HARDER THAN IT DOES
 * THERE.** `.or()` takes a filter STRING PostgREST parses: `,` splits the arms,
 * `.` splits column-operator-value and `)` closes a group. Over there the value
 * is a `auth.users` UUID that cannot carry one; HERE it is free text a person
 * typed into a search box, so an unquoted arm would let `a,b.eq.c` rewrite the
 * query's SHAPE — which, in a filter that is part of a tenancy fence, is the
 * whole game.
 */
export function orLiteral(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * 🔒 **THE DICTIONARY, NAMED ON THE QUERY SIDE OF EVERY `@@` IN THIS FEATURE.**
 *
 * ⚠ **IT IS NOT OPTIONAL AND OMITTING IT IS THE BUG THIS CONSTANT EXISTS TO
 * STOP (Samuel, 2026-09-17: *"I only see channels coming up from the search. I
 * don't see any messages"*).** PostgREST's `config` parameterises the
 * **tsquery FUNCTION**, never the column: `search_tsv=fts(simple).<q>` renders
 * `search_tsv @@ to_tsquery('simple', $1)`, and `search_tsv=fts.<q>` renders
 * `to_tsquery(<the server's `default_text_search_config`>, $1)` — which on this
 * deployment is `pg_catalog.english` (measured 2026-09-17,
 * `SELECT current_setting('default_text_search_config')`). Both generated
 * columns are built with `simple`, so an omitted config puts an ENGLISH-stemmed,
 * ENGLISH-stopworded query against a SIMPLE vector: `websearch_to_tsquery('each
 * verified')` is `'verifi'` — "each" is a stopword and "verified" stems — and
 * matched 0 of the 1,487 messages in the reporter's own rooms where the `simple`
 * spelling matched 45.
 * ⚠ **A WORD THAT DOES NOT STEM HIDES THIS.** `picker` matched identically under
 * both dictionaries, which is why the arm looked fine on a one-word probe and
 * was silently empty on the sentences people actually type.
 */
export const SEARCH_TSQUERY_CONFIG = "simple";

/** ⚠ A BOUND ON THE `tsquery`, NOT ON THE ANSWER. Every extra token is another
 *  `&` arm Postgres must intersect; a pasted paragraph is not a search. */
export const MAX_TSQUERY_TOKENS = 8;

/**
 * A typed string → a `to_tsquery` expression whose LAST token is a PREFIX.
 *
 * ⚠ **THE PREFIX IS THE WHOLE REASON THIS BUILDER EXISTS.** A popup is typed one
 * character at a time and `websearch_to_tsquery` matches WHOLE LEXEMES, so
 * `pick` could never find *picker* — the shape the knowledge arm works around
 * with a second `ilike` pass over the TITLE, which reaches no body at all. Only
 * the last token is a prefix: the earlier ones are words the reader finished
 * typing, and prefixing them would widen the intersection for no gain.
 *
 * ⚠ **IT CANNOT BE `type:"plain"` OR `type:"websearch"`.** `plainto_tsquery` and
 * `websearch_to_tsquery` normalise their input and would drop the `:*` on the
 * floor; the RAW form (`fts`, no `type`) is `to_tsquery`, which is the only one
 * of the three that honours it — and the only one that can raise a SYNTAX ERROR
 * on user text, which is what the sanitising below is for.
 *
 * ⚠ **THE SANITISER IS AN ALLOW-LIST OVER `\p{L}\p{N}_`, NOT AN ESCAPE PASS.**
 * `&`, `|`, `!`, `<->`, `(`, `)`, `'` and `:` are all `to_tsquery` OPERATORS; a
 * blocklist that missed one turns a person's search box into a tsquery editor
 * and a stray `(` into a 500. Splitting on the complement keeps exactly the
 * characters that can never be one.
 *
 * ⚠ `_` IS KEPT AND IT IS SAFE: the default parser splits `a_b` into two
 * lexemes, so `to_tsquery('simple','a_b:*')` is `'a':* <-> 'b':*` — a phrase
 * match, not a syntax error (measured 2026-09-17).
 *
 * @returns `null` for a query with no token at all (`"???"`), which is the
 * caller's signal to run NO full-text query rather than one matching everything.
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
