import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 🔒 THE OPENED BASE'S LAYOUT RULES — the four Samuel's live review returned on
 * 2026-08-28, pinned at the only place they are stateable.
 *
 * ⚠ THIS FILE IS A SOURCE READ AND THAT IS THE POINT, not a shortcut. jsdom has
 * no layout: it will not tell you that a panel fills half its host, that a
 * label wrapped, or that a textarea overflowed its card. Every one of these
 * defects renders IDENTICALLY to its fix in a layout-free renderer, so a
 * behavioural assertion here would be green in both directions — the exact
 * "regex over source text" trap INVARIANTS §14 warns about, inverted: the rule
 * applies to things that HAVE behaviour, and these have geometry instead. Same
 * shape as `shared/ui/section-panel.test.tsx › the /home ground`.
 *
 * ⚠ WHAT THIS CANNOT DO is prove the pane looks right. It proves the
 * declarations that were MISSING when it looked wrong are present, so the
 * specific regression cannot come back silently. Samuel reviews the live app.
 */

const MODULE = path.join(
  process.cwd(),
  "src",
  "features",
  "knowledge",
  "components",
  "knowledge-v2",
  "knowledge-v2.module.css"
);

/**
 * One rule's DECLARATIONS, by selector — comments stripped.
 *
 * 🔴 ⚠ THE STRIP IS THE WHOLE ASSERTION, AND THIS FILE PROVED IT THE HARD WAY.
 * Without it every check here was VACUOUS: this module's rules carry long
 * rationale comments that QUOTE the very declarations they are arguing for
 * (`.shell`'s note says "carries `flex: 1; min-width: 0`"), so
 * `toContain("flex: 1")` matched the prose and stayed green with the
 * declaration deleted. Measured 2026-08-28: mutating `flex: 1` out of `.shell`
 * left 5/5 passing. **A source read over a heavily-commented file must read the
 * CODE, not the file.**
 */
function rule(selector: string): string {
  const css = readFileSync(MODULE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing from knowledge-v2.module.css`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("🔒 the panel FILLS its host, floated or embedded", () => {
  /**
   * 🔒 Samuel, 2026-08-28: the opened base occupied the LEFT HALF of /home's
   * record pane, page-gray beside it, the header band stopping where the
   * content did. Cause: `.page-float` carries `flex: 1; min-width: 0`, and the
   * `embedded` mount drops the float — so it dropped the sizing with it and
   * the shell became a content-sized flex item of the record pane's Crossfade
   * row. The fix states the sizing on `.shell`, which BOTH mounts wear.
   *
   * ⚠ MUTATION-VERIFIED: deleting `flex: 1` from `.shell` turns the first
   * assertion red.
   */
  it("sizes itself rather than inheriting a surface's sizing", () => {
    const shell = rule(".shell");
    expect(shell).toContain("flex: 1");
  });

  it("can SHRINK on both axes, so its own content cannot push it past the pane", () => {
    // A flex item's default `min-*: auto` floors it at its content: without
    // these a long file name widens the panel, and the header/body stack never
    // hands its scroll to the two inner scrollers.
    const shell = rule(".shell");
    expect(shell).toContain("min-width: 0");
    expect(shell).toContain("min-height: 0");
    expect(rule(".baseBody")).toContain("min-width: 0");
  });
});

describe("🔒 the tree's create row wraps, so its pills do not", () => {
  it("wraps the ROW", () => {
    // Two labelled 26px pills against a 232px rail is a near-exact fit, and
    // near-exact is a promise about font metrics nobody can keep. The pills'
    // own `nowrap` + `shrink-0` are pinned in
    // `shared/ui/open-scale-button.test.tsx`.
    expect(rule(".addRow")).toContain("flex-wrap: wrap");
  });
});

describe("🔒 the description field stays inside its section", () => {
  /**
   * 🔒 Samuel, 2026-08-28: the textarea overflowed the card, its resize handle
   * sitting on the border.
   *
   * ⚠ THE RESIZE HANDLE IS THE SAME RULING AS THE DELETED SECTION GRIP. On a
   * flat section a drag handle grips air — and this one could be dragged WIDER
   * than the section containing it, which is what the screenshot showed.
   */
  it("cannot be dragged out of its card", () => {
    expect(rule(".fieldBlock")).toContain("resize: none");
  });

  it("is contained by width as well as by the resize rule", () => {
    // A textarea carries an intrinsic `cols` width, so `w-full` alone does not
    // contain it — the parent must be allowed to shrink and the field must be
    // capped. Both halves, because only both work.
    expect(rule(".fieldBlock")).toContain("max-width: 100%");
    expect(rule(".fieldGroup")).toContain("min-width: 0");
  });
});
