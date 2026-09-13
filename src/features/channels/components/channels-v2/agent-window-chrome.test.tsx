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
 *  - **A TAB IS FIXED WIDTH AND TRUNCATES** (*"It's a fixed size, and it does not get cut off"*) —
 *    a long agent name must not stretch the strip.
 *  - **THE BAR IS THE DRAG REGION AND THE CONTROLS OPT OUT.** Asserted over SOURCE: jsdom silently
 *    drops `-webkit-app-region`, so a render assertion would pass while the window sat frozen.
 *  - **THE BUTTONS RENDER ONLY WHEN THEY CAN ACT** — the feature-detection rule (INVARIANTS §11).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentWindowChrome } from "./agent-window-chrome";

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

  it("gives every tab a FIXED width and a truncated label", () => {
    installWindowOps();
    mountChrome({
      tabs: [{ key: TABS[0]!.key, name: "an agent with a very long operator-given name" }],
    });
    const tab = screen.getByRole("tab");
    expect(tab.className).toContain("truncate");
    expect(tab.parentElement?.className).toContain("w-[180px]");
    expect(tab.parentElement?.className).toContain("shrink-0");
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

  it("puts the ACTIVE tab's status to the LEFT of expand and close", () => {
    installWindowOps();
    mountChrome({ status: <span>Thinking</span> });
    const status = screen.getByText("Thinking");
    const expand = screen.getByRole("button", { name: "Expand" });
    expect(
      status.compareDocumentPosition(expand) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
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
