/**
 * **THE KB AUTHORING PREDICATES, AND THE HAND-COPY THEY CANNOT AVOID.**
 *
 * ⚠ Same construction and same argument as `./caps.test.ts`:
 * `packages/mcp-server` cannot import `src/`, so the agent surface holds a copy,
 * and a hand-copy nothing joins is drift waiting to happen. The join is a
 * SOURCE READ, not an import, so it fails from EITHER side.
 *
 * ⚠ **THE PIN IS BYTE-FOR-BYTE OVER A MARKED REGION, WHICH IS STRICTER THAN THE
 * CAPS' EXPRESSION CHECK AND HAS TO BE.** A cap is one number and a reader can
 * compare it by eye; a predicate is three branches and a regex, and "the same
 * rule, worded differently" is exactly the failure Samuel's ruling cannot
 * survive — a person warned about a page an agent would have been refused for
 * is two rules wearing one ruling. Identical text is the only cheap statement
 * that the two ANSWER the same.
 *
 * ⚠ **DRIFT HERE IS SILENT IN PRODUCTION.** Both halves compile, both surfaces
 * keep working, and the only symptom is that the app stops warning about the
 * entries the agent is being refused for.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { kbBodyIsUnsectioned, kbSummaryFault } from "./write-rules";
import { KB_SECTION_NUDGE_CHARS } from "./caps";

const START = "// ─── PREDICATE REGION";
const END = "// ─── END PREDICATE REGION ───";

/** The shared region of one copy, read as text — never imported. */
function regionOf(path: string): string {
  const source = readFileSync(join(process.cwd(), path), "utf8");
  const a = source.indexOf(START);
  const b = source.indexOf(END);
  // ⚠ A MISSING MARKER FAILS rather than passing vacuously — "somebody deleted
  // the region" is exactly the drift this exists for.
  expect(a, `${path} has no PREDICATE REGION start marker`).toBeGreaterThan(-1);
  expect(b, `${path} has no PREDICATE REGION end marker`).toBeGreaterThan(a);
  return source.slice(a, b + END.length);
}

describe("the KB authoring predicates agree across the import boundary", () => {
  const APP = "src/shared/knowledge/write-rules.ts";
  const SURFACE = "packages/mcp-server/src/tools/knowledge-write-predicates.ts";

  it("the pinned region is byte-for-byte identical in both copies", () => {
    expect(regionOf(SURFACE)).toBe(regionOf(APP));
  });

  it("the region actually contains both predicates — an empty region proves nothing", () => {
    const region = regionOf(APP);
    expect(region).toContain("export function kbSummaryFault(");
    expect(region).toContain("export function kbBodyIsUnsectioned(");
    expect(region).toContain("KB_ANY_HEADING_RE");
  });

  it("both copies read the length threshold from their own caps declaration", () => {
    // ⚠ THE IMPORT LINE IS OUTSIDE THE REGION, on purpose — the specifier
    // differs — so the pin cannot see it and this case is what does.
    expect(readFileSync(join(process.cwd(), APP), "utf8")).toContain(
      'import { KB_SECTION_NUDGE_CHARS } from "./caps";',
    );
    expect(readFileSync(join(process.cwd(), SURFACE), "utf8")).toContain(
      'import { KB_SECTION_NUDGE_CHARS } from "./knowledge-sections.js";',
    );
  });
});

describe("kbSummaryFault — the three shapes with no legitimate case", () => {
  it("absent, null and whitespace are all `missing`", () => {
    expect(kbSummaryFault(undefined, "Fuel prices")).toBe("missing");
    expect(kbSummaryFault(null, "Fuel prices")).toBe("missing");
    expect(kbSummaryFault("   ", "Fuel prices")).toBe("missing");
    // Punctuation alone folds to nothing, so it is missing rather than thin.
    expect(kbSummaryFault("—", "Fuel prices")).toBe("missing");
  });

  it("one word is `one_word`, with or without its full stop", () => {
    expect(kbSummaryFault("Fuel.", "Fuel prices")).toBe("one_word");
    expect(kbSummaryFault("Rates", "Fuel prices")).toBe("one_word");
  });

  it("the title again is `restates_title`, case and punctuation folded", () => {
    expect(kbSummaryFault("Fuel Prices!", "Fuel prices")).toBe("restates_title");
  });

  it("a real summary is null — INCLUDING a very short one that states a value", () => {
    // ⚠ THE CASE THE ABSENT LENGTH FLOOR EXISTS FOR.
    expect(kbSummaryFault("$3.18/gal base peg", "Fuel prices")).toBeNull();
    expect(
      kbSummaryFault("Why the 2026 peg replaced the 2024 table.", "Fuel prices"),
    ).toBeNull();
  });
});

describe("kbBodyIsUnsectioned — long, and addressable by nothing", () => {
  const LONG = "x".repeat(KB_SECTION_NUDGE_CHARS + 1);

  it("fires on a long body with no heading anywhere", () => {
    expect(kbBodyIsUnsectioned(LONG)).toBe(true);
  });

  it("does not fire below the threshold, however unsectioned", () => {
    expect(kbBodyIsUnsectioned("x".repeat(KB_SECTION_NUDGE_CHARS))).toBe(false);
  });

  it("does not fire when the body carries a heading", () => {
    expect(kbBodyIsUnsectioned(`## A\n${LONG}`)).toBe(false);
    expect(kbBodyIsUnsectioned(`# A\n${LONG}`)).toBe(false);
  });

  it("never fires on a SECTIONED write — the text in hand is not the document", () => {
    expect(kbBodyIsUnsectioned(LONG, "Rollback")).toBe(false);
  });

  it("⚠ a code-fence hash reads as a heading, and that FALSE NEGATIVE is the design", () => {
    expect(kbBodyIsUnsectioned("```\n# not a heading\n```\n" + LONG)).toBe(false);
  });
});
