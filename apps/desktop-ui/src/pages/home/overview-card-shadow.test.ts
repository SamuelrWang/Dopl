/**
 * 🔒 THE WHITE PANELS ON THE OVERVIEW'S GRAY WEAR `.bento`'S OWN RESTING
 * ELEVATION — ONE STEP, NOT TWO (Samuel, 2026-09-17: *"on the overview page, we
 * made it earlier where the white panels sitting on the gray background is more
 * elevated and has more shadow. I want to revert it to the old amount of
 * shadow."*).
 *
 * WHAT THIS REVERTS. `d5528cd1` (2026-09-13) minted `--shadow-card` and scoped it
 * to `[data-overview-face] .bento`; `370bd8cb` the same day tightened the value
 * (`0 12px 32px rgba(0,0,0,0.14)` → `0 6px 14px rgba(0,0,0,0.12)`) but kept the
 * step. Both are undone: the token, the scoped rule and the `data-overview-face`
 * hook that existed only to carry it are DELETED, so the Overview's cards fall
 * back to `--shadow-bento` — the pair they wore before 2026-09-13.
 *
 * ⚠ SOURCE AND NOT A RENDER, for the reason
 * `components/app-shell/frame-palette.test.ts` gives at length: jsdom paints
 * nothing, so a mounted assertion sees no box-shadow at all and passes over a
 * page that is visibly wrong. What can be pinned is the STATEMENT — which token
 * the recipe reads, and that no second, heavier one exists to drift onto.
 *
 * ⚠ BOTH KIT COPIES, ALWAYS. `src/app/globals.css` is the source of truth and
 * `apps/desktop-ui/src/styles/{tokens,kit}.css` is the SPA's only other copy;
 * `scripts/check-css-token-drift.ts` gates the TOKEN layer, and nothing gates the
 * RULE layer, so the rule half is asserted here against both files.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const REPO = join(HERE, "../../../../..");
/** ⚠ NEWLINES NORMALIZED — every literal below is multi-line; see
 *  `frame-palette.test.ts` for the red-Windows-run story behind this. */
const read = (rel: string) =>
  readFileSync(join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

const WEB_KIT = "src/app/globals.css";
const SPA_TOKENS = "apps/desktop-ui/src/styles/tokens.css";
const SPA_KIT = "apps/desktop-ui/src/styles/kit.css";

/** THE resting elevation of a white card on a gray well. Restored 2026-09-17. */
const BENTO_SHADOW =
  "--shadow-bento: 0 1px 2px rgba(0, 0, 0, 0.04), 0 6px 18px rgba(0, 0, 0, 0.05);";

describe("the Overview's white panels rest on `.bento`'s own shadow", () => {
  it("declares the resting pair, byte for byte, in both token copies", () => {
    expect(read(WEB_KIT)).toContain(BENTO_SHADOW);
    expect(read(SPA_TOKENS)).toContain(BENTO_SHADOW);
  });

  it("has `.bento` read that token and nothing else", () => {
    for (const file of [WEB_KIT, SPA_KIT]) {
      expect(read(file)).toContain("box-shadow: var(--shadow-bento);");
    }
  });

  /**
   * 🔒 THE DEEPER STEP IS GONE, NOT DISARMED. A rule left in place pointing at
   * the same value as `.bento` is a no-op today and the seam a future pass
   * deepens by one line; the revert is the DELETION.
   */
  it("keeps no heavier overview step to drift back onto", () => {
    // ⚠ DECLARATIONS AND READERS, NOT MENTIONS. The `--shadow-bento` docblock in
    // both token files NAMES the deleted token on purpose — that sentence is how
    // the next agent learns not to re-add it — so a bare substring check would
    // fail on its own tombstone.
    for (const file of [WEB_KIT, SPA_TOKENS, SPA_KIT]) {
      const css = read(file);
      expect(css).not.toMatch(/--shadow-card\s*:/);
      expect(css).not.toContain("var(--shadow-card)");
    }
    // Likewise the selector: a comment may name it, no rule may open with it.
    for (const file of [WEB_KIT, SPA_KIT]) {
      expect(read(file)).not.toMatch(/^\[data-overview-face\]/m);
    }
  });

  /**
   * ⚠ AND THE HOOK IS GONE FROM THE MARKUP TOO. `data-overview-face` bought
   * exactly one thing — the scoped shadow — so a surviving attribute would be a
   * dead selector target that reads like live geometry to the next agent. The
   * ghost and the page match by construction now, which is what the hook was for.
   */
  it("leaves no `data-overview-face` stamp on the face or its skeleton", () => {
    for (const file of [
      "apps/desktop-ui/src/pages/home/overview-panels.tsx",
      "apps/desktop-ui/src/pages/home/home-skeleton.tsx",
    ]) {
      expect(read(file)).not.toContain("data-overview-face>");
    }
  });
});
