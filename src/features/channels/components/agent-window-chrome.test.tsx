// @vitest-environment jsdom
/**
 * THE AGENT POP-OUT'S CHROME — the mark, the TAB STRIP and the window buttons (2026-09-13).
 *
 * ⚠ **IT MOUNTS `AgentWindowChrome` DIRECTLY NOW, NOT THE WHOLE WINDOW.** The bar moved out of
 * `agent-window.tsx` into `agent-window-chrome.tsx` when Samuel made the window TABBED — the bar
 * belongs to the window and outlives any one agent view — and its props are a tab list, a key and
 * three callbacks. Driving it through the window's harness would mean mocking four hooks to assert
 * a strip, which is how a test ends up pinning the mocks.
 *
 * The properties that fail SILENTLY, which is what earns them a test:
 *
 *  - **ORDER IS THE RULING.** Mark, tabs, then status → expand → close (*"move the ended
 *    badge/thinking badges and stuff to the left of the expand and X buttons"*). A reshuffle
 *    renders perfectly well; it is only WRONG.
 *  - **THE ACTIVE TAB IS UNDERLINED AND THE OTHERS ARE NOT** (*"the active tab is underlined"*).
 *  - **A TAB HUGS ITS LABEL, CAPS, AND TRUNCATES** (Samuel, 2026-09-15: *"Make it unfixed so that
 *    the tab will only go as long as the name is and the X will just be to the right of that"* —
 *    superseding the 2026-09-13 `w-[180px]` reading of *"It's a fixed size"*, whose surviving half
 *    is *"and it does not get cut off"*, i.e. the `truncate`). A long agent name must still not
 *    stretch the strip.
 *  - **THE LABEL IS BOLD AND AN INACTIVE TAB LIGHTS UP GRAY** (2026-09-15). Both are invisible to
 *    jsdom and both are the kind of thing a refactor silently drops.
 *  - **THE BAR IS THE DRAG REGION AND THE CONTROLS OPT OUT.** Asserted over SOURCE: jsdom silently
 *    drops `-webkit-app-region`, so a render assertion would pass while the window sat frozen.
 *  - **THE BUTTONS RENDER ONLY WHEN THEY CAN ACT** — the feature-detection rule (INVARIANTS §11).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentWindowChrome } from "./agent-window-chrome";
import { AGENT_TAB_TEXT } from "./agent-window-frame";

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

const LOGO = "data:image/png;base64,AAAA";

/** The bridge shape `spa-bridge-window.ts` detects — BOTH ops, or the buttons are correctly
 *  absent. */
function installWindowOps(
  ops: { close?: () => Promise<{ ok: boolean }>; toggleMaximize?: () => Promise<{ ok: boolean }> } = {}
): void {
  (window as { dopl?: unknown }).dopl = {
    // ⚠ `apiRequest` IS THE SPA MARKER AND IT IS NOT OPTIONAL HERE (`spa-bridge.ts ›
    // getSpaBridge`): a `window.dopl` without it is the LEGACY wrapper's partial object and
    // resolves to `null`, so `canControlOwnWindow()` answered false and this file's four
    // window-button cases asserted against a header that had correctly drawn none. The fake must
    // be a bridge before it can be a bridge with `appWindow` on it.
    apiRequest: () => Promise.resolve({ status: 200, statusText: "", hasBody: false }),
    appWindow: {
      close: ops.close ?? (() => Promise.resolve({ ok: true })),
      toggleMaximize: ops.toggleMaximize ?? (() => Promise.resolve({ ok: true })),
    },
  };
}

const TABS = [
  { key: "c1|t1|aaa", name: "#aaa" },
  { key: "c1|t2|bbb", name: "#bbb" },
];

function mountChrome(
  props: Partial<Parameters<typeof AgentWindowChrome>[0]> = {}
): { onSelect: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <AgentWindowChrome
      tabs={TABS}
      activeKey={TABS[0]!.key}
      onSelect={onSelect}
      onClose={onClose}
      logoSrc={LOGO}
      {...props}
    />
  );
  return { onSelect, onClose };
}

/** ⚠ CODE ONLY — this file's subject explains the drag region in prose, and a raw scan would match
 *  the docblock recording the decision rather than the attribute. */
const CODE = readFileSync(join(import.meta.dirname, "agent-window-chrome.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

describe("the chrome, left to right", () => {
  it("is the mark, then the tab strip — one tab per open agent, in main's order", () => {
    installWindowOps();
    mountChrome();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["#aaa", "#bbb"]);
    // The mark is decorative and comes FIRST in document order.
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe(LOGO);
    expect(
      img!.compareDocumentPosition(tabs[0]!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("marks the ACTIVE tab selected and underlines only that one", () => {
    installWindowOps();
    mountChrome();
    const [first, second] = screen.getAllByRole("tab");
    // ⚠ `getAttribute`, NOT `toHaveAttribute`: the ROOT vitest setup installs no `jest-dom`
    // (only `apps/desktop-ui` does), so the matcher is an "Invalid Chai property" at runtime AND
    // a `tsc` error — which is how four green-looking cases in this file failed two gates.
    expect(first!.getAttribute("aria-selected")).toBe("true");
    expect(second!.getAttribute("aria-selected")).toBe("false");
    // ⚠ THE UNDERLINE IS AN ELEMENT, so it can be counted: exactly one on screen. Marked with a
    // `data-` attribute rather than matched on a class fragment — the class is a geometry constant
    // now (`agent-window-frame.ts › TAB_UNDERLINE`) and a test that greps its spelling fails on
    // every re-position of a rule it is not about.
    expect(document.querySelectorAll("[data-tab-underline]").length).toBe(1);
  });

  /**
   * 🔒 *"Looking at the top you can see I want the name of the tab, like 'New Agent', to be bolded.
   * Right now you see all this blank space between where the name is and where the X is. That is
   * too much blank space. I notice that right now the tab looks like it's a fixed size. Make it
   * unfixed so that the tab will only go as long as the name is and the X will just be to the right
   * of that. Of course if the name is super long then you should fix it to a certain width so we
   * don't have too much overflow."* (Samuel, 2026-09-15)
   *
   * 🔒 MUTATION-PROOF: put `w-[180px]` back on `TAB_WIDTH` and the first expectation fails; drop
   * the cap entirely and the second does; drop `truncate` and the third; drop the ×'s `shrink-0`
   * and the last does.
   */
  it("hugs its label up to a CAP, and truncates rather than stretching the strip", () => {
    installWindowOps();
    mountChrome({
      tabs: [{ key: TABS[0]!.key, name: "an agent with a very long operator-given name" }],
    });
    const tab = screen.getByRole("tab");
    const box = tab.parentElement!;
    // ⚠ NO WIDTH AT ALL — the blank space before the × was a fixed box, not padding.
    // ⚠ `(^|\s)` AND NOT `\b` — a word boundary matches INSIDE `max-w-[200px]`, so the naive
    // pattern would fail on exactly the class this ruling asks for.
    expect(box.className).not.toMatch(/(^|\s)w-\[\d+px\]/);
    // ⚠ AND A CEILING, so *"if the name is super long"* ends in an ellipsis inside the tab.
    expect(box.className).toMatch(/\bmax-w-\[\d+px\]/);
    expect(box.className).toContain("shrink-0");
    expect(tab.className).toContain("truncate");
    // ⚠ `flex-1` IS WHAT PADDED A SHORT NAME OUT TO THE OLD BOX. `min-w-0` is what still lets the
    // label shrink once the cap is reached — the two look alike and only one of them is the bug.
    expect(tab.className).not.toContain("flex-1");
    expect(tab.className).toContain("min-w-0");
    // 🔒 **AND THE × SURVIVES THE TRUNCATION** — the cap makes the LABEL give way, so the close
    // control must be the one thing in the tab that cannot: a shrinking × at the longest name is
    // *"it does not get cut off"* failing on the half that is a control rather than text.
    const close = screen.getByRole("button", { name: /^Close / });
    expect(close.className).toContain("shrink-0");
    expect(close.parentElement).toBe(box);
  });

  /** 🔒 *"I want the name of the tab, like 'New Agent', to be bolded."* — read off the CONSTANT so
   *  the case cannot pass on a hand-typed weight the frame module does not own. */
  it("bolds the label, through the frame's own tab recipe", () => {
    installWindowOps();
    mountChrome();
    const tab = screen.getByRole("tab", { name: "#aaa" });
    for (const part of AGENT_TAB_TEXT.split(" ")) {
      expect(tab.className).toContain(part);
    }
    expect(tab.className).toContain("font-semibold");
  });

  /**
   * 🔒 *"On the tabs when I hover over a different tab, it should highlight gray or something so I
   * know that I can click on it."* (Samuel, 2026-09-15)
   *
   * ⚠ **ON THE INACTIVE ONES ONLY** — the active tab is where you already are, and a hover fill on
   * it promises a state change that will not happen.
   * ⚠ **THE FILL IS THE RAIL'S**, which is the one hover gray this window already draws; asserted
   * by name so a second gray for the same act fails here rather than on screen.
   */
  it("lights an INACTIVE tab gray under the pointer, and leaves the active one alone", () => {
    installWindowOps();
    mountChrome();
    const [active, idle] = screen.getAllByRole("tab").map((t) => t.parentElement!);
    expect(idle!.className).toContain("hover:bg-surface-raised-2");
    expect(idle!.className).toContain("cursor-pointer");
    expect(active!.className).not.toContain("hover:bg-");
    expect(active!.className).not.toContain("cursor-pointer");
  });

  it("selects on click and closes on the tab's own ×", () => {
    installWindowOps();
    const { onSelect, onClose } = mountChrome();
    fireEvent.click(screen.getByRole("tab", { name: "#bbb" }));
    expect(onSelect).toHaveBeenCalledWith(TABS[1]!.key);
    fireEvent.click(screen.getByRole("button", { name: "Close #bbb" }));
    expect(onClose).toHaveBeenCalledWith(TABS[1]!.key);
  });

  /** ⚠ THE WINDOW'S OWN Close IS A DIFFERENT CONTROL FROM A TAB'S ×, and their accessible names
   *  keep them apart — a tab's says WHICH agent. A single "Close" for both is how a click meant for
   *  one tab takes the window down. */
  it("keeps the window's Close distinct from a tab's ×", () => {
    installWindowOps();
    mountChrome();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close #aaa" })).toBeTruthy();
  });

  it("renders the + only when it can act, and reports the click", () => {
    installWindowOps();
    const onNewAgent = vi.fn();
    mountChrome({ onNewAgent });
    fireEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(onNewAgent).toHaveBeenCalledTimes(1);
  });

  it("draws NO + when the host cannot open one", () => {
    installWindowOps();
    mountChrome();
    expect(screen.queryByRole("button", { name: "New agent" })).toBeNull();
  });

  /**
   * 🔒 **THE CHROME CARRIES NOTHING ABOUT AN AGENT'S STATE, IN ANY STATE** (Samuel, 2026-09-15:
   * *"I don't want the badges to be there"*, then — on seeing the Ended badge at the foot —
   * *"for where you see 'running', 'thinking', or 'working' (all of those little things), put
   * that in the same spot, basically on the same line as 'in main channel', but to the right"*).
   *
   * ⚠ **IT SUPERSEDES THE 2026-09-13 RULING** this case used to pin (*"move the ended badge/
   * thinking badges … to the left of the expand and X buttons"*): the badges left the bar entirely.
   * ⚠ **THE PROP IS GONE, NOT EMPTY** (delete-don't-disarm), which is why this is a SOURCE read
   * as well as a render: a re-added `status` slot would render nothing until somebody passed it,
   * and then it would be back with no ruling behind it.
   *
   * 🔒 MUTATION-PROOF: re-add `{status}` to the right group and the source half fails; have the
   * page pass a badge again and `agent-ended.test.tsx`'s page pin fails.
   */
  it("carries no agent status at all — the right group is the window's two buttons", () => {
    installWindowOps();
    mountChrome();
    expect(CODE).not.toContain("status");
    expect(CODE).not.toContain("AgentLiveness");
    const group = screen.getByRole("button", { name: "Expand" }).parentElement!;
    expect(group.children).toHaveLength(2);
    expect(group.textContent).toBe("");
  });

  it("renders no window buttons at all when the bridge cannot close or zoom", () => {
    mountChrome();
    expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    // The tabs are still there — they do not depend on that bridge.
    expect(screen.getAllByRole("tab").length).toBe(2);
  });

  it("reaches the bridge for close and zoom", async () => {
    const close = vi.fn(() => Promise.resolve({ ok: true }));
    const toggleMaximize = vi.fn(() => Promise.resolve({ ok: true }));
    installWindowOps({ close, toggleMaximize });
    mountChrome();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("drags on the bar and NOT on its controls — source, because jsdom drops the property", () => {
    expect(CODE).toContain('WebkitAppRegion: "drag"');
    expect(CODE).toContain('WebkitAppRegion: "no-drag"');
    // ⚠ THE STRIP IS A CONTROL REGION TOO — tabs inside a drag region cannot be clicked — so
    // `NO_DRAG_REGION` appears TWICE: once on the strip, once on the right-hand group.
    expect(CODE.match(/style=\{NO_DRAG_REGION\}/g)?.length).toBe(2);
    expect(CODE.match(/style=\{DRAG_REGION\}/g)?.length).toBe(1);
  });
});

/**
 * 🔒 **NO × ON A MAIN THAT CANNOT CLOSE A TAB** (2026-09-14).
 *
 * ⚠ **`closeOwnTab` ANSWERS `{ ok: false }` ON SUCH A BUILD**, so the control rendered, reported
 * a click into a void and looked exactly like the working one — §11's absent-not-disabled rule
 * inverted. `spa-bridge-window.ts › canHostAgentTabs` had been written for precisely this gate
 * and had NO CALLER; `pages/agent-window/index.tsx` now passes `onCloseTab` only when it answers
 * true, and this prop is optional for that.
 *
 * 🔒 MUTATION-PROOF: make `onClose` required again (drop the `{onClose ? … : null}` branch) and
 * the first case fails; the strip's other controls are untouched either way, which is the second.
 */
describe("the tab × is a capability, not furniture", () => {
  it("draws no × at all without an onClose", () => {
    mountChrome({ onClose: undefined });
    expect(screen.queryByRole("button", { name: /^Close / })).toBeNull();
    // ⚠ THE TABS THEMSELVES SURVIVE: a build without the close op still SWITCHES tabs, because
    // selection is the renderer's own state and needs no main.
    expect(screen.getAllByRole("tab")).toHaveLength(TABS.length);
  });

  it("draws one × per tab when it can close", () => {
    mountChrome();
    expect(screen.getAllByRole("button", { name: /^Close / })).toHaveLength(TABS.length);
  });
});
