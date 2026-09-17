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
