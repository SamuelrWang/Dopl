/**
 * 🔒 /home's SEARCH PILL IS ALWAYS OPEN, AND THE KIT STILL HAS A CLOSED STATE
 * (Samuel, 2026-09-13: *"remove the expanding animation, just have the bar always
 * be expanded fixed"*).
 *
 * ⚠ **THE TWO HALVES OF THAT RULING ARE NOT THE SAME FILE, AND CONFLATING THEM
 * BROKE A SECOND SURFACE.** The PAGE stopped toggling (`home-search.tsx` renders
 * `data-open="true"` unconditionally); the KIT was also flattened, to
 * `.search-expand { width: 260px }` with no `[data-open]` on it — which reserves
 * the open width for the CLOSED pill too. The landing banner's home chrome
 * (`src/features/marketing/components/banner-demo/demo-home-chrome.tsx`) rendered
 * exactly that closed pill, so its header grew 224px of dead space beside a 36px
 * button. The width belongs on the state, not on the box.
 *
 * ⚠ **THAT SCENE RENDERS THE OPEN PILL SINCE 2026-09-17** (the hero demo was
 * rebuilt on /home's current UI), so the CLOSED face has no caller today. **The
 * cases below do not change with it**: the closed width is still the kit's, the
 * next caller would inherit the same bug from a flattened rule, and a state whose
 * width lives on the box is wrong whether or not anyone is currently in it.
 *
 * ⚠ SOURCE SCAN, AND BOTH COPIES. jsdom loads no stylesheet, so a mounted
 * assertion sees no width at all; and the kit is hand-copied into
 * `apps/desktop-ui/src/styles/kit.css` (F-074 — the drift `check-css-token-drift`
 * exists for), which compares `--*` DECLARATIONS and never rules. Same shape as
 * `shared/ui/menu-item-hover.test.tsx` and `app-shell/frame-palette.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "../../../../..");
/** ⚠ CRLF normalized — `frame-palette.test.ts` carries why a source pin must. */
const read = (rel: string) =>
  readFileSync(join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

const KIT = {
  spa: "apps/desktop-ui/src/styles/kit.css",
  web: "src/app/globals.css",
} as const;

/** The declarations of one rule, comments stripped. */
function rule(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = clean.indexOf(`\n${selector} {`);
  if (at === -1) throw new Error(`no rule \`${selector}\``);
  return clean.slice(at, clean.indexOf("}", at));
}

describe("🔒 the search pill's width lives on `[data-open]`, not on the box", () => {
  it.each(Object.entries(KIT))("%s: closed is one button wide", (_copy, rel) => {
    expect(rule(read(rel), ".search-expand")).toMatch(/width:\s*36px/);
  });

  it.each(Object.entries(KIT))("%s: open reserves the shell's width", (_copy, rel) => {
    const css = read(rel);
    // ⚠ THE SAME NUMBER THE SHELL GROWS TO, read out of the shell's own rule
    // rather than retyped, so the box and the pill cannot reserve different
    // widths the day 260 moves.
    const shell = rule(css, '.search-expand[data-open="true"] .search-expand-shell');
    const open = rule(css, '.search-expand[data-open="true"]');
    const width = shell.match(/width:\s*(\d+px)/)?.[1];
    expect(width).toBeTruthy();
    expect(open).toContain(`width: ${width}`);
  });

  it("/home renders the pill OPEN and brings no toggle button", () => {
    const src = read("apps/desktop-ui/src/pages/home/home-search.tsx");
    expect(src).toContain('data-open="true"');
    // The glyph is decoration now; a second focusable node in the pill would give
    // the field two accessible entries (the 2026-09-13 ruling deleted the toggle).
    expect(src).not.toMatch(/<button/);
  });
});
