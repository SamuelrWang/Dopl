/**
 * THE RECORD PANE'S DIVIDER IS 2px, AND IT HAS TO TELL THE RESIZE PILL SO
 * (Samuel, 2026-09-13: *"for the black vertical line that we're using so that the
 * user can use it to drag … right now it's sitting to the left. I want it to be
 * perfectly on the vertical line."*).
 *
 * ⚠ **WHY THIS IS A TEST AND NOT A COMMENT.** `channels-v2/info-resize-handle.tsx`
 * centres the pill on the divider by offsetting the hit strip half a border width,
 * read from `--channel-divider-w` with a **1px fallback** — the kit hairline the
 * workspace channels page wears. /home widens exactly that structural `border-l` to
 * 2px in `home.module.css`, so if this module ever stops declaring the variable the
 * pill goes back to sitting a pixel LEFT of the line on the one surface Samuel
 * reported it on, and nothing else fails: no type error, no missing class, no
 * console warning. That is the whole class of bug this file exists for.
 *
 * ⚠ **THE TWO DECLARATIONS MUST STAY IN ONE BLOCK.** Asserting they are both merely
 * *present* would pass a change that moved the border to 3px and left the variable
 * at 2 — so the width the border takes and the width it TELLS the handle are read
 * from the same rule.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  resolve(__dirname, "home.module.css"),
  "utf-8"
);

/** The declared value of one property inside the FIRST `.frame`-scoped rule that
 *  carries it — comments stripped, so a commented example cannot satisfy this. */
function declared(selector: string, property: string): string | null {
  const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = clean
    .split("}")
    .find((chunk) => chunk.includes(selector) && chunk.includes(property));
  if (!block) return null;
  const match = new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(block);
  return match ? match[1]!.trim() : null;
}

describe("/home's record pane tells the resize handle how wide its divider is", () => {
  it("widens the structural `border-l` to 2px", () => {
    expect(declared(".border-l.border-border-default", "border-left-width")).toBe(
      "2px"
    );
  });

  it("declares `--channel-divider-w` at the SAME width, on `.frame`", () => {
    expect(declared(".frame", "--channel-divider-w")).toBe("2px");
  });

  /** ⚠ ONE RULE, so the pair cannot drift — see the header. */
  it("keeps the two within one `.frame` rule block", () => {
    const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const widthAt = clean.indexOf("border-left-width");
    const varAt = clean.indexOf("--channel-divider-w");
    expect(widthAt).toBeGreaterThan(-1);
    expect(varAt).toBeGreaterThan(-1);
    // Adjacent rules: nothing but the closing brace, the `.frame` selector and
    // whitespace between them.
    expect(clean.slice(widthAt, varAt)).toMatch(
      /border-left-width:\s*2px;\s*}\s*\.frame\s*{\s*$/
    );
  });
});
