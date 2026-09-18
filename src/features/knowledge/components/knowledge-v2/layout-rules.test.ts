import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The opened base's layout rules — the four Samuel's live review returned on
 * 2026-08-28.
 *
 * A source read on purpose: jsdom has no layout, so these defects render
 * identically to their fixes and a behavioural assertion would be green in both
 * directions. INVARIANTS §14's "regex over source text" ban applies to things
 * that have behaviour; these have geometry. Same shape as
 * `shared/ui/section-panel.test.tsx › the /home ground`.
 *
 * It cannot prove the pane looks right — only that the declarations missing when
 * it looked wrong are present. Samuel reviews the live app.
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
 * The strip is the whole assertion: the module's rules carry rationale comments
 * that quote the declarations they argue for, so without it `toContain("flex:
 * 1")` matched the prose and stayed green with the declaration deleted.
 */
function rule(selector: string): string {
  const css = readFileSync(MODULE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing from knowledge-v2.module.css`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("🔒 the panel FILLS its host, floated or embedded", () => {
  /**
   * Samuel, 2026-08-28: the opened base occupied half of /home's record pane.
   * `.page-float` carries the sizing and the `embedded` mount drops the float,
   * so the sizing is stated on `.shell`, which both mounts wear.
   */
  it("sizes itself rather than inheriting a surface's sizing", () => {
    const shell = rule(".shell");
    expect(shell).toContain("flex: 1");
  });

  it("can SHRINK on both axes, so its own content cannot push it past the pane", () => {
    // a flex item's default `min-*: auto` floors it at its content: without
    // these a long file name widens the panel and the scroll never reaches the
    // two inner scrollers.
    const shell = rule(".shell");
    expect(shell).toContain("min-width: 0");
    expect(shell).toContain("min-height: 0");
    expect(rule(".baseBody")).toContain("min-width: 0");
  });
});

describe("🔒 the tree's create row wraps, so its pills do not", () => {
  it("wraps the ROW", () => {
    // two labelled 26px pills against a 232px rail is a near-exact fit, which
    // is a promise about font metrics nobody can keep.
    expect(rule(".addRow")).toContain("flex-wrap: wrap");
  });
});

describe("🔒 the description field stays inside its section", () => {
  /**
   * Samuel, 2026-08-28: the textarea overflowed the card, its resize handle on
   * the border — it could be dragged wider than the section containing it.
   */
  it("cannot be dragged out of its card", () => {
    expect(rule(".fieldBlock")).toContain("resize: none");
  });

  it("is contained by width as well as by the resize rule", () => {
    // a textarea carries an intrinsic `cols` width, so `w-full` alone does not
    // contain it: the parent must shrink AND the field must be capped.
    expect(rule(".fieldBlock")).toContain("max-width: 100%");
    expect(rule(".fieldGroup")).toContain("min-width: 0");
  });
});
