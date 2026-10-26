/**
 * /home's search pill and the kit's expanding search, as SOURCE pins (jsdom loads no
 * stylesheet and lays nothing out).
 *
 * /home renders a fixed 260px white pill (`features/search/components/header-search.tsx`); the kit's `.search-expand` keeps a
 * closed and an open state for its other hosts (the channels sidebar), and its width belongs on
 * the state, not the box: a width on the box reserved the open width for a closed pill once.
 * Both kit copies, since the desktop renders `kit.css` (F-074).
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

  /** 🔒 **`.selected-ring` IS DELETED FROM BOTH KIT COPIES (Samuel, 2026-09-17:
   *  *"sure delete it"*; F-713 RESOLVED), AND THE PIN LIVES HERE BECAUSE THIS
   *  PILL IS THE READER THE DESIGN DOC INVENTED FOR IT.** The row claimed the
   *  open pill wore the recipe; it never did — the held-focus look is the kit's
   *  own `:focus-within` rule below, which names the TOKENS. ⚠ **SO THE TOKENS
   *  ARE ASSERTED POSITIVELY**: a later "clean up the orphan" pass must take the
   *  rule and never `--focus-line` / `--raised-light-focus`. ⚠ BOTH COPIES —
   *  a rule deleted from one kit and left in the other is F-074's drift. */
  it.each(Object.entries(KIT))("%s: no `.selected-ring`, and the pill keeps the tokens", (_copy, rel) => {
    const css = read(rel);
    expect(css).not.toContain(".selected-ring");
    const focus = rule(css, '.search-expand[data-open="true"] .search-expand-shell:focus-within');
    expect(focus).toContain("var(--focus-line)");
    expect(focus).toContain("var(--raised-light-focus)");
  });
});

describe("🔒 /home's pill", () => {
  const src = read("src/features/search/components/header-search.tsx");
  // The face is the shared search pill's, which the Identities filter wears too.
  const face = read("src/shared/ui/search-pill.tsx");

  it("is a fixed 260px white pill with no toggle button", () => {
    expect(src).toContain("className={SEARCH_PILL_FACE}");
    expect(face).toContain("white-card raise-pill");
    expect(face).toContain("w-65");
    expect(src).not.toContain("search-expand");
    expect(src).not.toMatch(/<button/);
  });
});

/**
 * 🔒 THE POPUP SPANS PILL-LEFT TO PROFILE-RIGHT (Samuel, 2026-09-29; kept 2026-10-26). Anchored,
 * not measured: the card is the pill's SIBLING and fills the header's positioned action group,
 * whose first child is the pill and last is Profile.
 */
describe("🔒 the popup is anchored on the header's action group", () => {
  it("header-search renders the popup OUTSIDE the pill, spanning the group", () => {
    const src = read("src/features/search/components/header-search.tsx");
    const pill = src.indexOf("<label className={SEARCH_PILL}>");
    const close = src.indexOf("</label>");
    const popup = src.indexOf("<SearchPopup");
    expect(pill).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(pill);
    expect(popup).toBeGreaterThan(close);
    expect(src).toMatch(/className="left-0 w-auto"/);
  });

  /** 🔒 Samuel, 2026-10-26: the overhaul changes the inside, "not the dimensions of it". */
  it("the card's width is the anchor's, never its content's", () => {
    const popup = read("src/features/search/components/search-popup.tsx");
    const width = popup.match(/export const SEARCH_CARD_W = "([^"]+)"/)?.[1];
    expect(width).toBe("w-70 max-w-[calc(100vw-2rem)]");
    expect(popup).not.toMatch(/\bw-max\b|max-content|min-w-\[/);
  });

  it("the header's trail group is the positioned anchor, search first and Profile last", () => {
    const frame = read("apps/desktop-ui/src/pages/home/home-frame.tsx");
    expect(frame).toContain('<div className="relative flex items-center gap-2.5">{trail}</div>');
    const header = read("apps/desktop-ui/src/pages/home/home-header.tsx");
    const trail = header.slice(header.indexOf("trail={"));
    expect(trail.indexOf("<HeaderSearch")).toBeGreaterThan(-1);
    expect(trail.indexOf("<HomeSettingsControl")).toBeGreaterThan(trail.indexOf("<HeaderSearch"));
  });
});
