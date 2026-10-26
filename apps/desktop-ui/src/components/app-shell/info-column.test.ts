/**
 * The channel info column's slide shell, a SOURCE pin over both kit copies: jsdom computes no
 * layout, so what can fail is the rule text — the track that keeps the column from shrinking,
 * the layer that keeps the transcript from painting over it, and the width shared with the
 * agent overlay. Both copies, because the desktop renders `kit.css` (F-074).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "../../../../..");
const read = (rel: string) =>
  readFileSync(join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const KIT_CSS = "apps/desktop-ui/src/styles/kit.css";
const WEB_KIT_CSS = "src/app/globals.css";

/** Comments stripped, so an explanation cannot satisfy or fail a pin. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

/** The body of one CSS rule, by its opening selector text. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `${selector} is gone`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("the channel info column is fixed-width, and paints above the transcript", () => {
  it.each([
    ["web", WEB_KIT_CSS],
    ["desktop", KIT_CSS],
  ])("%s: the shell cannot shrink and owns a stacking layer", (_host, file) => {
    const body = rule(code(read(file)), "\n.channel-info-slide {");
    // The TRACK: `flex: 0 0 auto` is what makes the MAIN area absorb every pixel
    // of a narrowing window. Change it and the panel starts shrinking instead.
    expect(body, "the column became shrinkable").toContain("flex: 0 0 auto");
    // The LAYER: the transcript's positioned children (composer, popovers) paint
    // in CSS step 8 and would otherwise cover a later, non-positioned sibling.
    expect(body, "the paint-order fix is gone").toContain("position: relative");
    expect(body, "the paint-order fix is gone").toMatch(/z-index:\s*1\b/);
    // ⚠ And it must stay CLIPPED, or the layer covers the transcript in return.
    expect(body, "the layer without the clip is a new bug").toContain(
      "overflow: hidden"
    );
  });

  it("stays UNDER the agent overlay — the pane that is meant to cover it", () => {
    // ⚠ `agent-panel.tsx` is `z-20` and absolutely positioned against the same
    // right edge. The column's z-index is 1 ON PURPOSE: high enough to beat the
    // transcript's `auto`, low enough that opening an agent still covers this.
    // A future bump here silently puts the info column over the agent pane.
    expect(
      code(read("src/features/channels/components/agent-panel.tsx"))
    ).toContain("z-20");
  });

  it("the open width still matches the agent panel's, on both copies", () => {
    // The pairing `agent-panel.tsx` names in as many words — a mismatch makes
    // the divider jump sideways the moment an agent view opens.
    // ⚠ IT IS A VARIABLE SINCE 2026-09-13 AND THE PAIRING IS UNCHANGED — the operator
    // DRAGS this width (`channels/components/use-info-resize.ts`), so a literal in either place
    // is the same jump for a resized column. What is pinned is that all three sites state
    // the SAME expression, fallback included: the two kit copies here, `info-panel.tsx`'s
    // own `w-[…]`, and the agent overlay's.
    const EXPR = "var(--info-w, 380px)";
    for (const file of [WEB_KIT_CSS, KIT_CSS]) {
      expect(
        rule(code(read(file)), '\n.channel-info-slide[data-open="true"] {'),
        `${file} drifted off ${EXPR}`
      ).toContain(`width: ${EXPR}`);
    }
    // The TSX halves carry it without the space Prettier puts in the CSS one.
    for (const file of [
      "src/features/channels/components/agent-panel.tsx",
      "src/features/channels/components/info-panel.tsx",
    ]) {
      expect(code(read(file)), `${file} drifted off --info-w`).toContain(
        "w-[var(--info-w,380px)]"
      );
    }
    // And the hook's floor is the same number, so "never narrower than today" stays true.
    expect(
      code(read("src/features/channels/components/use-info-resize.ts"))
    ).toContain("INFO_WIDTH_DEFAULT = 380");
  });
});

