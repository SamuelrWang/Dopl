/**
 * THE POP-OUT WINDOW IS THE PANEL, EDGE TO EDGE (Samuel, 2026-08-27) — a SOURCE pin over the
 * whole painted stack.
 *
 * ⚠ IT TOOK THREE ATTEMPTS BECAUSE ONLY ONE LAYER WAS EVER ACCOUNTED FOR. Removing `.page-float`
 * from the component left the window still rendering a rounded panel on a gray ground, because
 * the frame ABOVE it was painting too. The layers, top to bottom:
 *
 *   1. `shell.root`          fixed inset-0; paints `--shell-surface` (the shell gray)
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
    "../../../../../src/features/channels/components/channels-v2/agent-window.tsx"
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
    // ⚠ `.root` is `position: fixed; inset: 0` and paints `--shell-surface`. If this layer
    // painted the same gray, the panel would simply not be there; if it painted nothing, the gray
    // would show wherever the content did not reach.
    expect(windowSurface).toContain("var(--panel-surface)");
    expect(windowSurface).not.toContain("var(--shell-surface)");
  });

  it("windowSurface has NO margin and NO radius — nothing to float inside", () => {
    expect(windowSurface).not.toMatch(/\bmargin\b/);
    expect(windowSurface).not.toMatch(/border-radius/);
  });

  it("layer 4 floats nothing — NO branch of the window component wears .page-float", () => {
    // ⚠ EVERY BRANCH, WHICH IS THE WHOLE POINT OF ASSERTING IT OVER THE FILE. The main return
    // gave `.page-float` up on 2026-08-27 and the "That agent isn't running" branch KEPT it, so
    // the one view this window renders entirely on its own — the gone-state — still drew the
    // rounded, bordered, shadowed card on layer 1's gray. A pin on the happy path could not have
    // seen it: that path was already correct.
    expect(windowComponent, "a branch took the floating card back").not.toContain("page-float");
    // What it wears instead, on both branches: layer 3's fill, no margin, no radius, no shadow.
    expect(windowComponent).toContain("bg-[var(--panel-surface)]");
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
