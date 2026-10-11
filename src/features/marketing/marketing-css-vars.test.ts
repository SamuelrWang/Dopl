// MARKETING CSS — THE CROSS-STYLESHEET `var()` GUARD (2026-10-11, release review).
//
// WHAT THIS FILE IS FOR. On 2026-10-10 three literals in `.lp-ont-window` were replaced with
// `var(--glass-card-*)`, declared in `src/app/globals.css › :root`. The values were identical and
// the change was reviewed as a pure de-duplication. On the WEB build the landing page's white
// panel then rendered with NO fill, NO radius and NO shadow: computed `background-color:
// rgba(0, 0, 0, 0)` and `border-radius: 0px`, because the SERVED stylesheet did not carry the
// declarations —
//
//     curl …/_next/static/css/app/layout.css | grep -c glass-card-fill   →  0
//     curl …/_next/static/css/app/layout.css | grep -c seg-fill          →  3
//
// `--seg-fill` survives and `--glass-card-fill` does not, and the difference is NOT staleness (a
// forced recompile reproduced it). It is that `--seg-fill` is also referenced from INSIDE
// globals.css, so it stays in that stylesheet's own graph, while a token declared in `:root` and
// consumed ONLY from another stylesheet was dropped from the output. The desktop SPA resolves all
// three correctly, which is exactly why nothing looked wrong while it was being built.
//
// ⚠ THIS GUARD IS THE CLASS, NOT THE INSTANCE. Reverting `.lp-ont-window` to literals fixes the
// panel; it does not stop the next token from being shared the same way. So the rule below is:
// a `var()` in marketing.css must resolve to a custom property that is EITHER declared in
// marketing.css itself, OR declared in globals.css AND referenced at least once from inside
// globals.css. The second arm is the empirical survival condition above.
//
// ⚠ IT CANNOT SEE THE BUILD. jsdom and vitest never run the CSS pipeline, so this does not prove
// what the served sheet contains — it pins the source condition that was shown to predict it. A
// true end-to-end check needs a built bundle, and that belongs in CI, not here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const MARKETING = readFileSync(join(ROOT, "src/features/marketing/marketing.css"), "utf8");
const GLOBALS = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

/**
 * Comments are blanked, not deleted, so offsets survive — and so a var NAME written inside a
 * comment can never be mistaken for a reference. This file's own header would otherwise trip it.
 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));

const MARKETING_CODE = stripComments(MARKETING);
const GLOBALS_CODE = stripComments(GLOBALS);

/** Every `--token` REFERENCED through `var()`, ignoring any fallback after the comma. */
function referenced(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) out.add(m[1]);
  return out;
}

/** Every `--token` DECLARED, i.e. appearing on the left of a colon. */
function declared(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/(^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g)) out.add(m[2]);
  return out;
}

/**
 * The plain-`:root` region of globals.css — everything OUTSIDE `@theme inline`.
 *
 * ⚠ THE DISTINCTION IS THE WHOLE FINDING. `--seg-fill` (globals.css:287) and
 * `--glass-card-fill` (:294) are declared seven lines apart in the SAME `:root` block, and one
 * survives into the served sheet while the other does not. The difference is that `--seg-fill`
 * is also referenced from inside globals.css. Tailwind's `@theme inline` vars are emitted by a
 * different mechanism and are NOT subject to this, so narrowing to the plain region is what
 * keeps the rule true instead of merely strict.
 */
function plainRootDeclared(css: string): Set<string> {
  const themeStart = css.indexOf("@theme inline");
  if (themeStart === -1) return declared(css);
  // The theme block ends at the first line that is exactly `}`.
  const afterTheme = css.indexOf("\n}", themeStart);
  const outside = css.slice(0, themeStart) + css.slice(afterTheme + 2);
  return declared(outside);
}

describe("marketing.css never depends on a token globals.css would drop", () => {
  it("🔒 no var() it uses is a plain-:root token that globals.css never references itself", () => {
    const localDecls = declared(MARKETING_CODE);
    const plainDecls = plainRootDeclared(GLOBALS_CODE);
    const globalRefs = referenced(GLOBALS_CODE);

    // ⚠ SCOPED TO THE ONE OBSERVED FAILURE CLASS, deliberately. A token this file uses that is
    // declared NOWHERE in globals.css is out of scope here and is not a defect: the six
    // `--lp-*` scrub vars are written at runtime by `use-banner-scrub.ts`
    // (`scene.style.setProperty`) and carry `var(…, fallback)`, and `--font-playfair` comes
    // from next/font in `app/layout.tsx:32` with a `, Georgia, serif` fallback. Flagging those
    // would make this case noise, and noise is how a guard gets muted.
    const orphans: string[] = [];
    for (const token of referenced(MARKETING_CODE)) {
      if (localDecls.has(token)) continue; // declared right here — always served
      if (!plainDecls.has(token)) continue; // not a plain-:root token — different mechanism
      if (globalRefs.has(token)) continue; // globals.css uses it too, so it stays in the graph
      orphans.push(token);
    }

    // ⚠ FAILS ON ABSENCE. A regex that stopped matching would make this case green by
    // scanning nothing, which is the shape of pass this whole file exists to distrust.
    expect(referenced(MARKETING_CODE).size).toBeGreaterThan(20);
    expect(plainDecls.size).toBeGreaterThan(50);
    expect(plainDecls.has("--seg-fill")).toBe(true); // the control: a token of the class that survives

    expect(orphans).toEqual([]);
  });

  it("🔒 .lp-ont-window states its three white-panel values as literals", () => {
    // The exact bytes from 96930123^, before the token swap. If a future edit shares these
    // again, the case above explains why the panel goes blank and this one says what it was.
    // ⚠ ANCHORED AT THE START OF A LINE. A bare `indexOf(".lp-ont-window {")` finds the
    // DESCENDANT rule `.lp-ont-banner[data-glass="scrub"] .lp-ont-window {` first, which holds
    // only opacity — so the case read the wrong block and said the literals were missing.
    const start = MARKETING_CODE.search(/^\.lp-ont-window \{/m);
    expect(start).toBeGreaterThan(-1);
    const block = MARKETING_CODE.slice(start, MARKETING_CODE.indexOf("}", start));
    expect(block).toContain("background: #ffffff;");
    expect(block).toContain("border-radius: 14px;");
    expect(block).toContain("box-shadow: 0 18px 50px rgba(0, 0, 0, 0.18);");
    expect(block).not.toContain("var(--glass-card");
  });
});
