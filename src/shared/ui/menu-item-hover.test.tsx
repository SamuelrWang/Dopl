// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MenuItem } from "./popover-menu";

/**
 * 🔒 THE GLOBAL MENU-OPTION HOVER RULE (Samuel, 2026-09-10, over the channel info
 * panel's "+ Add item"): *"I like that shade of gray … when I hover over options in
 * a dropdown, it turns this like white elevated button looking thing. I want you to
 * make it a design global rule, have them all be like the gray shadow from the +
 * add item."*
 *
 * ⚠ IT IS ONE TOKEN AND ONE CLASS, so this is where both are pinned: `MenuItem`
 * composes nothing but `.menu-row`, and `.menu-row`'s hover face is
 * `var(--menu-item-hover-bg)` — flat, with no gradient, no drop shadow and no lift.
 * Every `SelectMenu` option in the app is a `MenuItem`, so pinning the primitive
 * pins the rule.
 *
 * ⚠ BOTH CSS COPIES ARE CHECKED. The kit is hand-copied into
 * `apps/desktop-ui/src/styles/kit.css` (F-074, the drift that made
 * `check-css-token-drift.ts` a gate), and a rule Samuel called GLOBAL that holds on
 * one surface only is the exact defect that script exists to catch — it compares
 * `--*` declarations, not rules, so the RULE needs this test.
 *
 * ⚠ AND THE TOKEN IS BY REFERENCE. `--menu-item-hover-bg: var(--surface-raised-1)`
 * is the Add-item gray ITSELF (`info-card-rows.tsx › InfoCardAddRow` wears
 * `hover:bg-surface-raised-1`); a literal value here would be a second gray that
 * drifts from the one he pointed at.
 */
/** ⚠ Off `process.cwd()` (the vitest root), not `import.meta.url`: under the jsdom
 *  environment this file declares, a module-relative URL misses the tree — the same
 *  trap `settings-agent-harness.tsx › desktopSource` documents. */
const ROOT = process.cwd();
const CSS = {
  web: "src/app/globals.css",
  spa: "apps/desktop-ui/src/styles/kit.css",
} as const;
const PALETTE = {
  web: "src/app/globals.css",
  spa: "apps/desktop-ui/src/styles/tokens.css",
} as const;

const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** The `.menu-row:hover, .menu-row:focus-visible { … }` body, comments stripped. */
function hoverBlock(source: string): string {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = clean.match(/\.menu-row:hover,\s*\n?\s*\.menu-row:focus-visible\s*\{([^}]*)\}/);
  if (!m) throw new Error("no `.menu-row:hover, .menu-row:focus-visible` rule");
  return m[1];
}

describe("🔒 menu option hover — the Add-item gray, everywhere", () => {
  afterEach(cleanup);

  it("MenuItem's whole face is `.menu-row` — no bg-white, no shadow, no lift", () => {
    render(<MenuItem onSelect={() => {}}>Alpha</MenuItem>);
    const option = screen.getByRole("menuitem", { name: "Alpha" });
    const classes = option.className.split(/\s+/);
    expect(classes).toContain("menu-row");
    // ⚠ Prefix checks, so `hover:bg-white/70` and `focus-visible:shadow-…` count too.
    expect(classes.filter((c) => /(^|:)bg-white/.test(c))).toEqual([]);
    expect(classes.filter((c) => /(^|:)shadow/.test(c))).toEqual([]);
    expect(classes.filter((c) => /(^|:)(translate|-translate)/.test(c))).toEqual([]);
  });

  it.each(Object.entries(CSS))("%s: the hover face is the token, flat", (_surface, rel) => {
    const block = hoverBlock(read(rel));
    expect(block).toContain("var(--menu-item-hover-bg)");
    // The elevated face, gone: gradient fill, drop shadow, 1px lift.
    expect(block).not.toMatch(/linear-gradient/);
    expect(block).not.toMatch(/box-shadow/);
    expect(block).not.toMatch(/transform/);
    // No literal gray sneaking back in beside the token.
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it.each(Object.entries(CSS))("%s: keyboard focus wears the SAME face, not a ring", (_s, rel) => {
    const clean = read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
    // ⚠ COUNTED, not pattern-matched: the ONE permitted mention is the shared
    // `:hover, :focus-visible` selector above. A SECOND one is the 2px focus ring
    // (or any other face) re-elevating the keyboard-focused option.
    expect(clean.match(/\.menu-row:focus-visible/g)?.length).toBe(1);
  });

  it.each(Object.entries(PALETTE))("%s: the token is `--surface-raised-1` BY REFERENCE", (_s, rel) => {
    const decl = read(rel).match(/--menu-item-hover-bg:\s*([^;]+);/);
    expect(decl?.[1].trim()).toBe("var(--surface-raised-1)");
  });
});
