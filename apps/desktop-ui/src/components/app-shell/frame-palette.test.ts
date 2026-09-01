/**
 * THE WORKSPACE SHELL AND /home WEAR ONE FRAME — a SOURCE pin over the painted
 * chrome (Samuel, live review 2026-08-30: *"the workspace pages adopt /home's
 * frame model and palette — the two surfaces must match"*).
 *
 * ⚠ SOURCE AND NOT A RENDER, for the reason `pages/agent-window/frame.test.ts`
 * gives at length: jsdom paints nothing, so a mounted assertion sees no
 * background at all and passes over a shell that is visibly wrong. What can be
 * pinned is the STATEMENT — which token each painter reads, and that no second
 * near-identical value exists to drift onto.
 *
 * ⚠ IT TOOK THREE CUTS AND THE TWO WRONG ONES ARE PINNED HERE BY NAME, because
 * both are a plausible reading of the words and neither is what /home does:
 *
 *   ✗ `.sidebar` painted `--home-frame` — nav rows floating on bare dark, no
 *     panel under them. **The dark is FRAME ONLY**: the margin around panels,
 *     never a surface content sits on.
 *   ✗ `.sidebar` given its own panel face — sidebar and page as two SIBLING
 *     floats with a 2px line between them. **The panels NEST**: *"the right
 *     panel sits ON TOP OF the gray panel that holds the sidebar."*
 *   ✓ ONE gray float spanning rail → right edge, the nav standing directly on
 *     it, the routed page a white card floating inside — `pages/home/index.tsx`
 *     exactly, with the nav where the relationship list is.
 *
 * The four things the ruling asks for, and the four groups below:
 *   1. the GROUND — rail, shell root and shell surface read `--home-frame`, and
 *      nothing reads the retired `#2c3640` any more;
 *   2. the STRUCTURE — one panel composed from the kit's `.page-float`, a
 *      sidebar that paints nothing, a page card that is /home's record pane
 *      class for class, and levels 2/3 alternating white → gray;
 *   3. the EDGE — `.page-float` wears `--home-panel-line` at the SAME 2px the
 *      /home record pane wears, read out of both files rather than asserted
 *      twice by hand;
 *   4. the FLOAT — /home and the workspace shell share ONE geometry because they
 *      share ONE recipe: `.page-float`'s margins reveal the frame around the
 *      panel on both surfaces.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const REPO = join(HERE, "../../../../..");
/** ⚠ NEWLINES NORMALIZED, AND A RED WINDOWS RUN IS WHY (2026-09-01). Every
 *  assertion below is a multi-line literal containing `\n`; a Windows checkout
 *  used to hand this file CRLF and every one of them missed by one invisible
 *  byte, on code that was correct. The repo-root `.gitattributes` (`eol=lf`)
 *  is the real fix and covers every source-pinning test at once — this stays as
 *  the local belt, because a test that reads source must not depend on how the
 *  reader's git is configured. */
const read = (rel: string) =>
  readFileSync(join(REPO, rel), "utf8").replace(/\r\n/g, "\n");

const SHELL_CSS = "src/shared/layout/app-shell/app-shell.module.css";
const RAIL_CSS =
  "apps/desktop-ui/src/components/app-shell/account-rail.module.css";
const KIT_CSS = "apps/desktop-ui/src/styles/kit.css";
const WEB_KIT_CSS = "src/app/globals.css";
const SPA_TOKENS = "apps/desktop-ui/src/styles/tokens.css";
const SHELL_TSX = "apps/desktop-ui/src/components/app-shell/app-shell.tsx";
const RAIL_TSX = "apps/desktop-ui/src/components/app-shell/account-rail.tsx";
const HOME_PAGE = "apps/desktop-ui/src/pages/home/index.tsx";
const HOME_SKELETON = "apps/desktop-ui/src/pages/home/home-skeleton.tsx";
const LAYOUT_SHELL = "src/shared/layout/layout-shell.tsx";

const shellCss = read(SHELL_CSS);
const railCss = read(RAIL_CSS);

/** ⚠ CODE ONLY. Every file here EXPLAINS the value it no longer uses, by name —
 *  a raw read would fail on the explanation, which is the failure mode that
 *  teaches the next agent to delete the explanation. */
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

describe("the app frame is ONE ground", () => {
  // ⚠ `.sidebar` IS DELIBERATELY NOT ON THIS LIST — it is a PANEL, pinned in the
  // next block. It WAS here for one iteration and that is exactly the bug.
  it.each([
    ["\n.root {", shellCss],
    ["\n.surface {", shellCss],
  ])("%s paints var(--home-frame)", (selector, css) => {
    const body = rule(css, selector);
    expect(body).toContain("background: var(--home-frame)");
    // ⚠ THE REGRESSION IS THE GRAY COMING BACK, not a missing token: with
    // `--shell-surface` here the page card floats on the same colour it is
    // painted against and Samuel's ruling item 4 ("the panel must visibly sit
    // ON the blue ground top AND bottom") silently stops holding.
    expect(body, "the shell gray came back").not.toContain(
      "var(--shell-surface)"
    );
  });

  it("the account rail paints the same token — no per-page repaint left", () => {
    expect(rule(railCss, "\n.rail {")).toContain("background: var(--home-frame)");
    // ⚠ /home used to force the ink on three mounts (`!bg-home-frame` ×3) because
    // the shell painted something else. Both halves matter: the rail reads the
    // token AND no page overrides it, or the two surfaces can drift again.
    for (const file of [HOME_PAGE, HOME_SKELETON]) {
      expect(code(read(file)), `${file} took the frame override back`).not.toContain(
        "bg-home-frame"
      );
    }
  });

  it("nothing paints the retired #2c3640 — one frame value, not two", () => {
    // Ledger ASK-31, settled by the same ruling. `--rail` (the old frame ink)
    // is deleted; `--body-bg` and the web body paint read the frame token.
    for (const file of [SPA_TOKENS, WEB_KIT_CSS, SHELL_CSS, RAIL_CSS, LAYOUT_SHELL]) {
      expect(code(read(file)), `${file} still carries the old frame hex`).not.toContain(
        "#2c3640"
      );
    }
    for (const file of [SPA_TOKENS, WEB_KIT_CSS]) {
      expect(code(read(file))).toContain("--body-bg: var(--home-frame)");
      expect(code(read(file)), "--rail is back").not.toMatch(/--rail\s*:/);
    }
  });

});

describe("ONE gray panel, with the page floating inside it", () => {
  const shellTsx = code(read(SHELL_TSX));

  it("the shell composes the kit's .page-float for its panel — not a copy", () => {
    // 🔒 THE STRUCTURE SAMUEL ASKED FOR, THIRD TIME: one float spanning rail →
    // right edge, exactly as `pages/home/index.tsx` does it. Reading the class
    // off the TSX (not a module rule) is the point — the FACE is the kit's, so
    // /home's panel and this one cannot drift.
    expect(shellTsx).toContain('cn("page-float", styles.panel)');
    // Layout only in the module: a fill or a border here would be a second
    // statement of the panel face.
    const panel = rule(shellCss, "\n.panel {");
    expect(panel, "the panel restated a face the kit already owns").not.toMatch(
      /background|border:/
    );
  });

  it("the SIDEBAR is a region of that panel — no fill, no border, no float", () => {
    // 🔒 BOTH REJECTED CUTS AT ONCE. It was `--home-frame` (nav rows on bare
    // dark), then a sibling float with its own 2px line and 7/9 margins (a
    // border between the sidebar and the page). It paints NOTHING now.
    const body = rule(shellCss, "\n.sidebar {");
    for (const forbidden of ["background", "border", "margin", "border-radius"]) {
      expect(body, `the sidebar took ${forbidden} back`).not.toContain(forbidden);
    }
    expect(body).toContain("var(--shell-sidebar-w)");
  });

  it("the routed page is /home's record pane, class for class", () => {
    const card = rule(shellCss, "\n.pageCard {");
    expect(card).toContain("background: var(--home-card)");
    expect(card).toMatch(/border:\s*2px solid var\(--home-panel-line\)/);
    expect(card).toMatch(/border-radius:\s*14px/);
    // ⚠ READ AGAINST /home's OWN LINE, not asserted twice by hand — the two
    // surfaces match because they say the same three things.
    expect(code(read(HOME_PAGE))).toContain(
      "rounded-[14px] border-2 border-home-panel-line bg-home-card"
    );
    // The inset is what lets the gray show around the card; /home's pane takes
    // `mb-3 mr-3`, this adds the top its panel has no header strip to supply.
    expect(card).toMatch(/margin:\s*12px 12px 12px 0/);
    expect(shellTsx).toContain("styles.pageCard");
  });

  it("the page's own .page-float collapses inside the card — face only", () => {
    const reset = rule(shellCss, ".pageCard :global(.page-float) {");
    expect(reset).toContain("margin: 0");
    expect(reset).toContain("background: transparent");
    // ⚠ THE SIZING SURVIVES. `.page-float` carries `flex: 1; min-width: 0` and
    // views composed with it never restate that (DESIGN-SYSTEM's note on the
    // class); resetting it here renders every workspace page at content width.
    expect(reset, "the reset ate the float's sizing").not.toMatch(
      /flex\s*:|min-width\s*:/
    );
  });

  it("no nav-chip rebind survives — the kit's light-panel recipe is the face", () => {
    // The dark-ground rebind (and the `--home-frame-*` pair behind it) died with
    // the sidebar's frame paint; `.nav-chip` stands on light gray again, which
    // is the ground its own recipe was written for.
    expect(code(shellCss), "the dark-ground chip rebind came back").not.toContain(
      ".sidebar :global(.nav-chip)"
    );
    for (const file of [SPA_TOKENS, WEB_KIT_CSS]) {
      expect(code(read(file))).not.toMatch(/--home-frame-(ink|hover)\s*:/);
    }
  });

  it("levels 2 and 3: a card on the panel is white, a well on the card is gray", () => {
    // The Pro upsell sits in the sidebar region, i.e. ON the gray panel → white.
    expect(rule(shellCss, "\n.wordsCard {")).toContain("background: var(--home-card)");
    // A section panel is drawn on a PAGE, i.e. inside the white card → gray, the
    // same token /home's record-pane wells take. Both hosts, one colour.
    expect(code(read("src/shared/ui/section-panel.tsx"))).toContain(
      'SECTION_PANEL_GROUND =\n  "border border-border-subtle bg-home-panel"'
    );
    const homeCss = read("apps/desktop-ui/src/pages/home/home.module.css");
    const wells = homeCss.slice(homeCss.indexOf(".frame :global([data-section-panel])"));
    expect(wells.slice(0, wells.indexOf("}"))).toContain("var(--home-panel)");
  });

  it("a COLUMN of the chat area takes the chat area's own level, not a panel's", () => {
    // 🔒 Samuel's standing ruling for the agent slide-out: *same background as the
    // main chat area.* That area paints no ground of its own — it inherits the
    // white card (`.pageCard` in the shell, the record pane on /home) — so this
    // pane reads `--home-card`. It has now been wrong twice in the other
    // direction: `--panel-surface` while `.page-float` was white, then
    // `--home-panel` for the hour the page float WAS the gray panel, which is
    // what put a gray pane against a white transcript.
    expect(
      code(read("src/features/channels/components/channels-v2/agent-panel.tsx"))
    ).toContain("bg-[var(--home-card)]");
  });

  it("but the POP-OUT window is outside the frame model and does not follow it", () => {
    // A pop-out has no rail, frame or panel to be a level of; it sits on
    // `.windowSurface`, which paints `--panel-surface`. `pages/agent-window/
    // frame.test.ts` pins the stack layer by layer — this reads the one value
    // that the in-shell moves above kept trying to drag along with them.
    expect(
      code(read("src/features/channels/components/channels-v2/agent-window.tsx"))
    ).toContain("bg-[var(--panel-surface)]");
    expect(rule(shellCss, "\n.windowSurface {")).toContain("var(--panel-surface)");
  });
});

describe("the rail reads the same on both hosts", () => {
  it("the panel butts the rail — one statement, no host-specific sliver", () => {
    // 🔒 SPACING PARITY (Samuel, 2026-08-30: rail tile spacing differed between
    // /home and workspace pages). The visible dark column must be the 54px rail
    // EXACTLY, or a rail-centred tile reads shifted left. Three parts, and all
    // three have to hold: the shell gap is zero in both token copies, the
    // workspace panel zeroes `.page-float`'s own left margin, and /home zeroes
    // the same one on its `<main>`.
    for (const file of [SPA_TOKENS, WEB_KIT_CSS]) {
      expect(code(read(file))).toContain("--shell-gap-left: 0px");
    }
    expect(rule(shellCss, "\n.panel {")).toContain("margin-left: 0");
    expect(code(read(HOME_PAGE))).toContain("page-float !ml-0");
    // And the surface's own override is GONE on both — the token does that now.
    for (const file of [HOME_PAGE, HOME_SKELETON]) {
      expect(code(read(file)), `${file} still overrides the surface margin`).not.toContain(
        'shell.surface, "!ml-0"'
      );
    }
  });

  it("the selected tile owns the ONLY horizontal line in the rail", () => {
    // 🔒 Samuel: the selected tile *"shows a double borderline at the top"* — the
    // account/container divider rule sat 7px above it, stacking against
    // `.raised-tab`'s hairline. The boundary is rhythm now (4px on top of the
    // rail's 7px gap), not a second line.
    expect(code(railCss), "the divider rule came back").not.toContain(".divider");
    expect(code(read(RAIL_TSX)), "the divider element came back").not.toContain(
      "styles.divider"
    );
    expect(rule(railCss, "\n.workspaces {")).toContain("margin-top: 4px");
  });

  it("the resting nav chip is the lighter gray, in both copies", () => {
    // One statement, one consumer (`.nav-chip:not(.nav-chip-active)`), two
    // mounts that both wanted it: the app sidebar and the settings-modal rail.
    for (const file of [SPA_TOKENS, WEB_KIT_CSS]) {
      expect(code(read(file))).toContain("--shell-chip: #e8e8e8");
    }
  });
});

describe("the panel's fill and edge match /home's record pane", () => {
  it.each([KIT_CSS, WEB_KIT_CSS])(
    "%s: .page-float is --home-panel behind a 2px --home-panel-line",
    (file) => {
      const body = rule(read(file), "\n.page-float {");
      expect(body).toContain("background: var(--home-panel)");
      expect(body).toMatch(/border:\s*2px solid var\(--home-panel-line\)/);
    }
  );

  it("and that is the RECORD PANE's own statement, read from /home", () => {
    // ⚠ THE POINT OF READING BOTH. Item 3 of the ruling is "the border blue
    // matched, SAME WIDTH" — a number agreeing with a number by luck is what
    // this prevents. The pane says `border-2 border-home-panel-line`; the kit
    // recipe above says `2px solid var(--home-panel-line)`. Same token, same 2.
    expect(code(read(HOME_PAGE))).toContain("border-2 border-home-panel-line");
  });
});

describe("the float geometry is shared, not copied", () => {
  it("the workspace pages and /home compose the ONE recipe", () => {
    // ⚠ THE PAGES STILL COMPOSE IT AND THAT IS DELIBERATE. Inside the workspace
    // shell the class collapses to a plain filling box (`.pageCard :global(...)`
    // above) because the SHELL owns the surface there; the class keeps meaning
    // "THE full-page surface" for the mounts that supply their own — /home's
    // `<main>`, the pop-out thread window, the web playground. Stripping it from
    // sixteen files would have stripped it from those three too.
    expect(code(read(HOME_PAGE))).toContain("page-float");
    for (const page of [
      "apps/desktop-ui/src/pages/overview/index.tsx",
      "apps/desktop-ui/src/pages/settings/index.tsx",
      "src/features/channels/components/channels-v2/channels-v2-core.tsx",
      "src/features/members/components/members-v2/members-v2-view.tsx",
      "src/features/agent-templates/components/agent-templates-core.tsx",
    ]) {
      expect(code(read(page)), `${page} stopped floating on the frame`).toContain(
        "page-float"
      );
    }
  });

  it("the margins that REVEAL the frame are stated once, in the kit", () => {
    // Item 4: the panel sits on the ground top AND bottom. That is these two
    // numbers plus a `.surface` that paints the frame (pinned above) — and since
    // the workspace panel and /home's `<main>` are both `.page-float`, the two
    // surfaces float identically without either restating a number.
    for (const file of [KIT_CSS, WEB_KIT_CSS]) {
      expect(rule(read(file), "\n.page-float {")).toContain("margin: 7px 8px 9px 8px");
    }
  });
});
