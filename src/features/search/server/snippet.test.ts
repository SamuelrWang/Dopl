/**
 * THE SNIPPET'S ONE PROMISE: **plain text, `<mark>…</mark>` and NOTHING ELSE.**
 *
 * The payload documents that a renderer may set `SearchItem.snippet` as HTML, so
 * every character that is not one of those two tags has to arrive escaped. The
 * properties that fail quietly:
 *  - 🔒 **A BODY'S OWN TAGS ARE ESCAPED.** `ts_headline` copies the source
 *    through verbatim, which is why the snippet is built here instead; a test
 *    that only checked "contains `<mark>`" would pass against either.
 *  - 🔒 **THE ESCAPE HAPPENS AROUND THE MATCH, NOT BEFORE IT.** Escaping first
 *    and marking second breaks a query containing `&` or `<` — it would never
 *    match its own body — and cannot tell an inserted mark from a quoted one.
 *  - **`lastIndex` IS RESET PER CALL.** A `g` regex reused across rows resumes
 *    where the last row ended and silently misses early matches.
 *
 * MUTATION-VERIFY: 3 reverts, 3 failures, 0 vacuous (2026-09-17) — emitting the
 * matched text UNESCAPED inside the mark, dropping the `pattern.lastIndex = 0`
 * reset, and sorting the terms shortest-first each turn a case here red (1, 4
 * and 2 failures respectively).
 */

import { describe, it, expect } from "vitest";
import {
  buildSnippet,
  escapeHtml,
  highlightPattern,
  highlightTerms,
  SNIPPET_CHARS,
} from "./snippet";

const patternFor = (q: string) => highlightPattern(highlightTerms(q));

describe("highlightTerms", () => {
  it("puts the whole query first and the longest words next", () => {
    // ⚠ A shortest-first order would mark `ship` and leave `ping` bare, because
    // the alternation takes the first arm that matches at a position.
    expect(highlightTerms("shipping ship")).toEqual(["shipping ship", "shipping", "ship"]);
  });

  it("drops the websearch operators rather than highlighting them", () => {
    expect(highlightTerms('"alpha" or -beta')).toEqual([
      "alpha beta",
      "alpha",
      "beta",
    ]);
  });

  it("is empty for a blank query, which yields no pattern at all", () => {
    expect(highlightTerms("   ")).toEqual([]);
    expect(highlightPattern([])).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes & first by construction, so nothing is double-escaped", () => {
    expect(escapeHtml("a & <b> \"c\" 'd'")).toBe(
      "a &amp; &lt;b&gt; &quot;c&quot; &#39;d&#39;"
    );
  });
});

describe("🔒 buildSnippet — the only markup is <mark>", () => {
  it("marks the hit and escapes the body's own tags", () => {
    const out = buildSnippet("<script>alpha</script>", patternFor("alpha"));
    expect(out).toBe("&lt;script&gt;<mark>alpha</mark>&lt;/script&gt;");
    // ⚠ MUTATION CHECK. The only `<` that survives is a mark's.
    expect(out?.replace(/<\/?mark>/g, "")).not.toContain("<");
  });

  it("matches a query that CONTAINS an escapable character", () => {
    // ⚠ This is the case that fails if the window is escaped before matching:
    // `A&B` would be hunted inside `A&amp;B` and never found.
    expect(buildSnippet("say A&B twice", patternFor("A&B"))).toBe(
      "say <mark>A&amp;B</mark> twice"
    );
  });

  it("marks every occurrence, not just the first", () => {
    const pattern = patternFor("ab");
    expect(buildSnippet("ab cd ab", pattern)).toBe(
      "<mark>ab</mark> cd <mark>ab</mark>"
    );
    // ⚠ MUTATION CHECK for the `lastIndex` reset: the SAME regex object, reused.
    expect(buildSnippet("ab cd ab", pattern)).toBe(
      "<mark>ab</mark> cd <mark>ab</mark>"
    );
  });

  it("windows a long body around the first hit and marks the ends", () => {
    const body = `${"x".repeat(400)} needle ${"y".repeat(400)}`;
    const out = buildSnippet(body, patternFor("needle")) as string;
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toContain("<mark>needle</mark>");
    // The ellipses are not part of the budget, so allow for the two of them.
    expect(out.replace(/<\/?mark>/g, "").length).toBeLessThanOrEqual(
      SNIPPET_CHARS + 2
    );
  });

  it("returns undefined for a body with nothing in it", () => {
    // ⚠ `undefined`, never `""` — an absent snippet reads as "this kind has no
    // body", which is a different claim from "the body is blank".
    expect(buildSnippet("", patternFor("a"))).toBeUndefined();
    expect(buildSnippet(null, patternFor("a"))).toBeUndefined();
    expect(buildSnippet("   \n  ", patternFor("a"))).toBeUndefined();
  });

  it("still escapes when there is no pattern to mark with", () => {
    expect(buildSnippet("<b>", null)).toBe("&lt;b&gt;");
  });

  it("collapses whitespace so a snippet is one line", () => {
    expect(buildSnippet("a\n\n  b", null)).toBe("a b");
  });
});
