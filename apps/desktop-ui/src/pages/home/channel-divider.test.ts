/**
 * THE SKINNED PANE'S DIVIDER IS 2px, AND IT HAS TO TELL THE RESIZE PILL SO
 * (Samuel, 2026-09-13: *"for the black vertical line that we're using so that the
 * user can use it to drag … right now it's sitting to the left. I want it to be
 * perfectly on the vertical line."*).
 *
 * ⚠ **WHY THIS IS A TEST AND NOT A COMMENT.** `channels/components/info-resize-handle.tsx`
 * centres the pill on the divider by offsetting the hit strip half a border width,
 * read from `--channel-divider-w` with a **1px fallback** — the kit hairline a host
 * that does not wear the skin keeps. The skin widens exactly that structural
 * `border-l` to 2px, so if the rule ever stops declaring the variable the pill goes
 * back to sitting a pixel LEFT of the line, and nothing else fails: no type error,
 * no missing class, no console warning. That is the whole class of bug this file
 * exists for.
 *
 * ⚠ **THE TWO DECLARATIONS MUST STAY ADJACENT.** Asserting they are both merely
 * *present* would pass a change that moved the border to 3px and left the variable
 * at 2 — so the width the border takes and the width it TELLS the handle are read
 * as one pair.
 *
 * ⚠ **BOTH KIT COPIES, WHICH IS HALF THE POINT SINCE R-38 (2026-09-17).** The rules
 * left `home.module.css › .frame` for the kit when Samuel ruled the workspace pages
 * adopt /home's palette; the kit is hand-mirrored (F-074) and the drift gate's class
 * half only sees `@layer components`, which this block is deliberately outside of.
 * The DESKTOP renders `kit.css`, so a fix that lands only on the web file is
 * invisible in the app Samuel filed this from.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const HERE = import.meta.dirname;
const REPO = resolve(HERE, "../../../../..");

const COPIES: [string, string][] = [
  ["web", "src/app/globals.css"],
  ["desktop", "apps/desktop-ui/src/styles/kit.css"],
];

/** The file with comments stripped, so a commented example cannot satisfy this. */
const code = (rel: string) =>
  readFileSync(resolve(REPO, rel), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declared value of one property inside the FIRST rule that carries both. */
function declared(css: string, selector: string, property: string): string | null {
  const block = css
    .split("}")
    .find((chunk) => chunk.includes(selector) && chunk.includes(property));
  if (!block) return null;
  const match = new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(block);
  return match ? match[1]!.trim() : null;
}

describe.each(COPIES)(
  "%s: the account palette skin tells the resize handle how wide its divider is",
  (_host, rel) => {
    it("widens the structural `border-l` to 2px", () => {
      expect(
        declared(code(rel), ".border-l.border-border-default", "border-left-width")
      ).toBe("2px");
    });

    it("declares `--channel-divider-w` at the SAME width, on the skin hook", () => {
      expect(declared(code(rel), "[data-frame-skin]", "--channel-divider-w")).toBe(
        "2px"
      );
    });

    /** ⚠ ADJACENT RULES, so the pair cannot drift — see the header. */
    it("keeps the two next to each other", () => {
      const css = code(rel);
      const widthAt = css.indexOf("border-left-width");
      const varAt = css.indexOf("--channel-divider-w");
      expect(widthAt).toBeGreaterThan(-1);
      expect(varAt).toBeGreaterThan(-1);
      // Nothing but the closing brace, the hook selector and whitespace between.
      expect(css.slice(widthAt, varAt)).toMatch(
        /border-left-width:\s*2px;\s*}\s*\[data-frame-skin\]\s*{\s*$/
      );
    });
  }
);

/**
 * 🔒 **AND THE HOSTS THAT WEAR IT ARE NAMED** — the rule is inert without the
 * attribute, and an inert skin looks like a design change nobody made. /home's
 * record pane and its ghost, and the workspace channels page: R-38's *"the two
 * surfaces must match"* is exactly this list being longer than one.
 */
describe("the two hosts that wear the skin", () => {
  it.each([
    "apps/desktop-ui/src/pages/home/index.tsx",
    "apps/desktop-ui/src/pages/home/home-skeleton.tsx",
    "src/features/channels/components/channels-core.tsx",
  ])("%s carries data-frame-skin", (rel) => {
    expect(readFileSync(resolve(REPO, rel), "utf-8")).toContain("data-frame-skin");
  });

  it("and the page module no longer fences a second copy", () => {
    expect(code("apps/desktop-ui/src/pages/home/home.module.css")).not.toContain(
      ":global("
    );
  });
});
