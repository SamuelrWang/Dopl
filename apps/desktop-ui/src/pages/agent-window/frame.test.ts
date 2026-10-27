/**
 * THE POP-OUT WINDOW IS THE PANEL, EDGE TO EDGE (Samuel, 2026-08-27) — a SOURCE pin over the
 * whole painted stack.
 *
 * ⚠ IT TOOK THREE ATTEMPTS BECAUSE ONLY ONE LAYER WAS EVER ACCOUNTED FOR. Removing `.page-float`
 * from the component left the window still rendering a rounded panel on a gray ground, because
 * the frame ABOVE it was painting too. The layers, top to bottom:
 *
 *   1. `shell.root`          fixed inset-0; paints the app FRAME (`--home-frame`; it was the
 *                            `--shell-surface` gray until 2026-08-30 — either way, a ground this
 *                            window must cover, which is the only thing this file cares about)
 *   2. `shell.body`          transparent flex row
 *   3. `shell.windowSurface` paints `--panel-surface`, ZERO margin, ZERO radius  ← the fix
 *   4. the window component  paints `--panel-surface`, no margin/radius/shadow
 *
 * Layer 3 was `shell.surface`, which carries the MAIN window's 8px radius and its four-sided
 * margin — correct there, and inside a pop-out it drew the rounded panel and let layer 1's gray
 * show around it.
 *
 * ⚠ SOURCE AND NOT A RENDER, because jsdom paints nothing: a render test could mount this frame
 * and see no background at all, which is precisely how the earlier version passed while the real
 * window was visibly wrong.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
/** ⚠ CODE ONLY. The page's own docblock says the words "`shell.surface`" while explaining why it
 *  does NOT use it — a raw read fails on the explanation. Measured, on this file's first run. */
const page = readFileSync(join(HERE, "index.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");
const shellCss = readFileSync(
  join(HERE, "../../../../../src/shared/layout/app-shell/app-shell.module.css"),
  "utf8"
);
/** LAYER 4 — the window component itself, stripped the same way and for the same reason. */
const windowComponent = readFileSync(
  join(
    HERE,
    "../../../../../src/features/channels/components/agent-window.tsx"
  ),
  "utf8"
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

/** The `.windowSurface` rule body. */
const windowSurface = shellCss.slice(
  shellCss.indexOf(".windowSurface {"),
  shellCss.indexOf("}", shellCss.indexOf(".windowSurface {"))
);

describe("the pop-out's painted stack", () => {
  it("mounts windowSurface, never the main window's framed surface", () => {
    expect(page).toContain("shell.windowSurface");
    // ⚠ `shell.surface` IS THE REGRESSION — the main window's margin and radius.
    expect(page, "the pop-out took the framed surface back").not.toMatch(
      /shell\.surface\b/
    );
  });

  it("windowSurface paints the PANEL colour, covering the shell gray beneath", () => {
    // ⚠ `.root` is `position: fixed; inset: 0` and paints the app frame. If this layer painted
    // that same ground, the panel would simply not be there; if it painted nothing, the frame
    // would show wherever the content did not reach.
    expect(windowSurface).toContain("var(--panel-surface)");
    expect(windowSurface).not.toContain("var(--shell-surface)");
  });

  it("windowSurface has NO margin and NO radius — nothing to float inside", () => {
    expect(windowSurface).not.toMatch(/\bmargin\b/);
    expect(windowSurface).not.toMatch(/border-radius/);
  });

  /**
   * 🔒 **LAYER 4 IS THE TABBED SHELL SINCE 2026-09-13, AND IT IS GRAY WITH A WHITE CARD INSIDE IT
   * (Samuel: *"notice that it's a white panel that's inset now on a darker background … It should
   * be the same color that we have on our current site"*).** This SUPERSEDES the 2026-08-27 pass
   * this file was written for — the pop-out is no longer "the panel, edge to edge": it is the FRAME
   * MODEL's alternation at window scale, `--home-panel` ground → `.bento` inset panel.
   *
   * ⚠ **LAYERS 1–3 ARE UNCHANGED AND STILL PINNED ABOVE.** `shell.windowSurface` still covers the
   * app frame with no margin and no radius; what changed is what the component inside it paints.
   * ⚠ **`.page-float` IS STILL FORBIDDEN ON EVERY BRANCH** — that recipe is a page's floating card
   * with its own margin, and the inset panel here is a `.bento` inside a window that already holds
   * the gray. Two different cards, and the wrong one is still the wrong one.
   */
  it("layer 4 is the gray shell with a white inset panel — and never .page-float", () => {
    const shellComponent = readFileSync(
      join(
        HERE,
        "../../../../../src/features/channels/components/agent-window-shell.tsx"
      ),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    // The GROUND is the site gray, by token — the SHELL's, and it stays there.
    expect(shellComponent).toContain("bg-home-panel");
    expect(shellComponent).not.toContain("page-float");
    // ⚠ **THE INSET FACE IS `channels/components/agent-window-frame.ts › INSET_PANEL` SINCE 2026-09-13's
    // SECOND PASS** (the shell re-exports it): the chrome had to read the window's rail width to
    // align the tab strip, so the window's shared geometry became its own module and the card face
    // went with it. A ground and a card are different layers and are now measured in different
    // files — which is the only reason this case reads two.
    const frameModule = readFileSync(
      join(
        HERE,
        "../../../../../src/features/channels/components/agent-window-frame.ts"
      ),
      "utf8"
    );
    // The INSET is the app's own card recipe at the window's radius.
    expect(frameModule).toContain("bento");
    expect(frameModule).toContain("rounded-[14px]");
    expect(frameModule).not.toContain("page-float");
    // ⚠ AND THE AGENT VIEW PAINTS NO GROUND OF ITS OWN — one painter per surface. A
    // `--panel-surface` fill there would sit inside the card and hide its radius, which is the
    // regression this half of the pin exists for.
    expect(windowComponent).not.toContain("bg-[var(--panel-surface)]");
    expect(windowComponent).not.toContain("page-float");
  });

  it("no branch of the window component wears .page-float", () => {
    // ⚠ EVERY BRANCH, WHICH IS THE WHOLE POINT OF ASSERTING IT OVER THE FILE. The main return
    // gave `.page-float` up on 2026-08-27 and the "That agent isn't running" branch KEPT it, so
    // the one view this window renders entirely on its own — the gone-state — still drew the
    // rounded, bordered, shadowed card on layer 1's gray. A pin on the happy path could not have
    // seen it: that path was already correct.
    expect(windowComponent, "a branch took the floating card back").not.toContain("page-float");
    // ⚠ THE SECOND HALF OF THIS CASE MOVED UP into the tabbed-shell case above: what the view
    // wears instead is now NOTHING (the shell's `.bento` is the surface), where until 2026-09-13
    // it was `bg-[var(--panel-surface)]` on both branches.
  });

  it("and the main window's surface KEEPS both — this added a class, it did not edit one", () => {
    // ⚠ `.surface` is the main window's and its frame is the point there: the page card floats on
    // the shell gray with breathing room. Editing it would have flattened every page in the app.
    const surface = shellCss.slice(
      shellCss.indexOf("\n.surface {"),
      shellCss.indexOf("}", shellCss.indexOf("\n.surface {"))
    );
    expect(surface).toMatch(/border-radius:\s*8px/);
    expect(surface).toMatch(/margin:/);
  });
});

/**
 * 🔒 **EVERY CONTROL IN THIS WINDOW'S CHROME IS FEATURE-DETECTED** (INVARIANTS §11 — a control
 * that cannot act must be ABSENT, never dead or disabled).
 *
 * ⚠ **THE "+" WAS THE ONE THAT WAS NOT.** The window buttons read `canControlOwnWindow()` and the
 * form's own Launch reads `canLaunchAgents()` — but the "+" that OPENS that form was wired
 * unconditionally, so a browser or a main predating the launch ops drew a "+" whose dialog had no
 * Launch button in it. The chrome already drops the "+" when `onNewAgent` is absent
 * (`agent-window-chrome.tsx`), so passing `undefined` is the whole gate.
 *
 * ⚠ SOURCE, like the rest of this file: mounting the page needs the whole bridge, the workspace
 * read and a router, and what is being pinned is the STATEMENT — which op this control is gated on.
 */
describe("the chrome's controls are feature-detected", () => {
  it("the tab strip's + is gated on the LAUNCH op, the same one the form gates on", () => {
    expect(page).toMatch(/onNewAgent=\{canLaunchAgents\(\)\s*\?/);
    expect(page).toContain("canLaunchAgents");
    // ⚠ NOT the tab ops: the "+" spawns an agent, it does not close or list tabs, and gating it on
    // `canHostAgentTabs()` would be a second answer to a different question.
    // ⚠ **NARROWED FROM `not.toContain("canHostAgentTabs")` ON 2026-09-14**, and the reason is
    // that the file-wide form was asserting something this case is not about: the × on each tab
    // IS gated on `canHostAgentTabs()` now (`agent-window-chrome.tsx` draws no × without an
    // `onCloseTab`, and `closeOwnTab` answers `{ ok: false }` on a main without the ops — a
    // control that looked live and did nothing). What must stay true is that the "+" is gated on
    // the LAUNCH op and on nothing else, which is what this line now says.
    expect(page).not.toMatch(/onNewAgent=\{canHostAgentTabs/);
  });
});
