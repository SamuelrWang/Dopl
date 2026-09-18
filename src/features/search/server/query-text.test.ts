/**
 * The text that goes into a filter: the `ilike` escaper, the `.or()` quoter, and
 * the tsquery builder that is the query side of every `@@` here.
 *
 * The builder is unit-tested, not only pinned at the repository, because
 * `to_tsquery` is the one spelling that RAISES on bad input — the price of the
 * `:*` the others discard. A repository test proves the string was sent; only
 * this proves what it can contain.
 *
 * MUTATION-VERIFY: 4 reverts, 4 failures, 0 vacuous (2026-09-17).
 */

import { describe, it, expect } from "vitest";
import {
  MAX_TSQUERY_TOKENS,
  SEARCH_TSQUERY_CONFIG,
  buildPrefixTsQuery,
  containsPattern,
  escapeLikeLiteral,
  orLiteral,
  prefixPattern,
} from "./query-text";

describe("🔒 buildPrefixTsQuery", () => {
  it("prefixes the LAST token and only the last", () => {
    // The earlier tokens are words the reader finished typing; prefixing them
    // widens the intersection for nothing.
    expect(buildPrefixTsQuery("each verified pick")).toBe(
      "each & verified & pick:*"
    );
  });

  it("makes a half-typed word reach the whole one", () => {
    expect(buildPrefixTsQuery("pick")).toBe("pick:*");
  });

  it("🔒 strips every to_tsquery OPERATOR a person can type", () => {
    // `&`, `|`, `!`, `:`, `(`, `)`, `'` and `<->` are all operators; the
    // allow-list keeps `\p{L}\p{N}_` and splits on everything else.
    expect(buildPrefixTsQuery("a & b | !c")).toBe("a & b & c:*");
    expect(buildPrefixTsQuery("(one)'two':*")).toBe("one & two:*");
    expect(buildPrefixTsQuery('"quoted phrase"')).toBe("quoted & phrase:*");
    expect(buildPrefixTsQuery("don't stop")).toBe("don & t & stop:*");
  });

  it("keeps digits and underscores, which cannot be operators", () => {
    // `a_b` is two lexemes to the parser (`'a':* <-> 'b':*`), a phrase match
    // rather than a syntax error.
    expect(buildPrefixTsQuery("plan_9")).toBe("plan_9:*");
  });

  it("returns null when nothing survives the allow-list", () => {
    // `null` means "run no query", never "match everything".
    expect(buildPrefixTsQuery("???")).toBeNull();
    expect(buildPrefixTsQuery("   ")).toBeNull();
    expect(buildPrefixTsQuery("")).toBeNull();
  });

  it("caps the token count", () => {
    const built = buildPrefixTsQuery("a b c d e f g h i j k");
    expect(built?.split("&")).toHaveLength(MAX_TSQUERY_TOKENS);
    expect(built?.endsWith(":*")).toBe(true);
  });

  it("names the dictionary the generated columns were built with", () => {
    // The constant is the fix: omitted, PostgREST falls to the server's
    // `default_text_search_config` (english here) against a simple vector.
    expect(SEARCH_TSQUERY_CONFIG).toBe("simple");
  });
});

describe("the like patterns", () => {
  it("escapes the wildcards a person typed", () => {
    expect(escapeLikeLiteral("100%_x")).toBe("100\\%\\_x");
    expect(containsPattern("100%")).toBe("%100\\%%");
    expect(prefixPattern("sam")).toBe("sam%");
  });
});

describe("🔒 orLiteral", () => {
  it("quotes a value that would otherwise rewrite the filter's SHAPE", () => {
    expect(orLiteral("a,b.eq.c")).toBe('"a,b.eq.c"');
    expect(orLiteral('say "hi"')).toBe('"say \\"hi\\""');
  });
});
