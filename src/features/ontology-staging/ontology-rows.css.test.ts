/**
 * THE ROWS SHEET'S SCOPING INVARIANT, AS A STANDING CHECK (2026-10-24).
 *
 * ⚠ WHY THIS EXISTS, and it is a reasoning artifact as much as a test. The claim
 * "every `.uis-ont-*` rule is scoped under `.uis-window`" is what licenses the
 * rows face to keep its own stylesheet at all: `ui-staging/staging.css` and
 * everything the staging frame imports is served into ALL SIX `/playground`
 * routes, so an unscoped `.uis-ont-*` rule would restyle the other five faces.
 *
 * That claim was true, and it rested on me grepping the file by hand — which is
 * the weakest kind of evidence there is. A hand grep is a claim about one
 * moment, it expires silently the next time anyone writes, and the author is
 * the only one who ever saw it. A test is a standing check: anyone can re-run
 * it, it fails loudly, and it outlives the session that wrote it
 * (Rail Fix's rung, 2026-10-24: read-back < author-written test < independent
 * read, and the middle one is the only rung a single agent can leave behind).
 *
 * ⚠ COMMENTS ARE STRIPPED FIRST, ON PURPOSE. A naive regex over raw CSS reports
 * false positives off comment prose — this very sheet's header contains the
 * words `.uis-ont-*`, `:has(`, and a `calc(3 * …)` example, and an earlier
 * hand-audit of mine misread exactly those as live selectors. Identities Polish
 * hit the same thing (27 "leaks", all of them sentences). Strip, then parse.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SHEET = join(__dirname, "ontology-rows.css");

/** CSS with every `/* … *\/` comment removed, so prose cannot look like code. */
function sheetWithoutComments(): string {
  return readFileSync(SHEET, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Every selector list in the sheet: the text before each `{`, minus at-rule
 * headers (`@media`, `@supports`) which scope nothing by themselves.
 */
function selectors(): string[] {
  const css = sheetWithoutComments();
  const out: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const raw = match[1].trim();
    if (raw === "" || raw.startsWith("@")) continue;
    // A selector list may hold several comma-separated selectors.
    for (const one of raw.split(",")) {
      const sel = one.trim();
      if (sel !== "") out.push(sel);
    }
  }
  return out;
}

describe("ontology-rows.css scoping invariant", () => {
  it("has selectors to check at all (guards against a parser that matches nothing)", () => {
    // ⚠ The detector's own sanity check. A test that silently parses zero
    // selectors would pass every assertion below while proving nothing — the
    // false-negative shape that cost this project a whole evening.
    expect(selectors().length).toBeGreaterThan(20);
  });

  it("scopes EVERY `.uis-ont-*` rule under `.uis-window`", () => {
    const unscoped = selectors().filter(
      (sel) => sel.includes(".uis-ont-") && !sel.includes(".uis-window")
    );
    // Named in the failure so a breakage says which rule, not just "a rule".
    expect(unscoped).toEqual([]);
  });

  it("declares no bare-element selector, which would reach the other five faces", () => {
    // `div { … }` or `span { … }` here would restyle every playground route.
    // An element is allowed only when qualified by a class (`a.uis-ont-chip`).
    const bare = selectors().filter((sel) =>
      sel
        .split(/\s+/)
        .some((part) => /^[a-z][a-z0-9]*$/.test(part) && !part.startsWith("@"))
    );
    expect(bare).toEqual([]);
  });

  it("keeps the element-qualified chip rules scoped too", () => {
    // `a.uis-ont-chip` / `button.uis-ont-chip` carry an element on purpose, to
    // outrank `ExternalAnchor`'s hard-coded link utilities by specificity. They
    // still have to sit under `.uis-window`.
    const chips = selectors().filter((sel) => /\b[a-z]+\.uis-ont-chip/.test(sel));
    expect(chips.length).toBeGreaterThan(0);
    for (const sel of chips) expect(sel).toContain(".uis-window");
  });
});
