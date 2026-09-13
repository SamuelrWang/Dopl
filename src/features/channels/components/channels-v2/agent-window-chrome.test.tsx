// @vitest-environment jsdom
/**
 * THE AGENT POP-OUT'S TOP BAR (Samuel, 2026-09-13, modelling Wispr Flow's pop-out) — the window is
 * FRAMELESS now, so this bar IS the window's chrome.
 *
 * The properties that fail SILENTLY, which is what earns them a test:
 *
 *  - **ORDER IS THE RULING.** Mark, name, then status → expand → close. Samuel gave the right
 *    group's order in a second message the same day (*"move the ended badge/thinking badges and
 *    stuff to the left of the expand and X buttons"*), and a reshuffle renders perfectly well —
 *    it is only WRONG, which no other kind of test notices.
 *  - **THE BAR IS THE DRAG REGION.** Without it a frameless window cannot be moved at all, and
 *    with it on a CONTROL the click is swallowed. Asserted over SOURCE: jsdom silently drops
 *    `-webkit-app-region`, so a render assertion would pass while the window sat frozen.
 *  - **THE BUTTONS RENDER ONLY WHEN THEY CAN ACT** — the feature-detection rule (INVARIANTS §11).
 *    A close button that cannot close is worse than the OS button it replaced.
 *  - **THE OLD BAR ICON IS GONE**, and the name is what took its slot.
 *  - **THE GLYPHS ARE NAKED** — no button face, muted at rest. The kit's `bare` idiom, not a
 *    hand-rolled hover tint (docs/DESIGN-SYSTEM.md, F-345's "do not add a seventh").
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installBridge, mount, summary } from "./agent-window-harness";

vi.mock("../../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({ messages: [], loading: false, refetch: () => {} }),
}));
vi.mock("./live", () => ({ useChannelsV2Live: () => ({ gate: {} }) }));
vi.mock("../../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [], refetch: () => {} }),
}));
vi.mock("../../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    consent: { mutate: () => {}, pending: false },
    unaddressedResponder: { mutate: () => {}, pending: false },
  }),
}));

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

const LOGO = "data:image/png;base64,AAAA";

/** ⚠ CODE ONLY — this file's subject explains the drag region in prose, and a raw scan would
 *  match the docblock recording the decision rather than the attribute. */
const SOURCE = readFileSync(join(import.meta.dirname, "agent-window.tsx"), "utf8");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

describe("the top bar, left to right", () => {
  it("is the Dopl mark, then the agent's NAME — never the old bar icon", async () => {
    installBridge();
    await mount({ logoSrc: LOGO });
    const header = document.querySelector("header") as HTMLElement;
    const mark = header.querySelector("img") as HTMLImageElement;
    expect(mark.getAttribute("src")).toBe(LOGO);
    // ⚠ SHORTER THAN THE BAR, IN A ROUNDED SQUARE — Samuel's instruction, literally.
    expect(mark.className).toContain("h-6");
    expect(mark.className).toContain("rounded-[8px]");
    const name = screen.getByText("flint");
    expect(name.className).toContain("text-body");
    expect(name.className).toContain("font-medium");
    // The mark precedes the name in the DOM, which is what "to the left of the name" is.
    expect(mark.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ⚠ THE REMOVED ICON: a 15px lucide `Bot` at the far left. Its `svg` was the header's FIRST
    // child; today the first element is the mark.
    expect(header.firstElementChild).toBe(mark);
  });

  it("puts the status badge LEFT of expand, and expand left of close", async () => {
    installBridge({ sessions: [summary({ state: "ended" })] });
    await mount({ logoSrc: LOGO });
    const badge = screen.getByText("Ended");
    const expand = screen.getByRole("button", { name: "Expand" });
    const close = screen.getByRole("button", { name: "Close" });
    const order = [badge, expand, close];
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(
        order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${i} must precede ${i + 1}`
      ).toBeTruthy();
    }
  });

  it("renders the LIVENESS badge in that same slot while the agent is working", async () => {
    // ⚠ THE WORD IS THE VERDICT'S, not this file's — `agents-model.ts › agentLiveness` is the ONE
    // mapping from state to label, and a working agent running a tool reads "Running <tool>".
    installBridge();
    await mount({ logoSrc: LOGO });
    const badge = await screen.findByText("Running Bash");
    const expand = screen.getByRole("button", { name: "Expand" });
    expect(badge.compareDocumentPosition(expand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the two controls", () => {
  it("expand calls the window's own zoom op; close calls its close op", async () => {
    const { closeWindow, toggleMaximize } = installBridge();
    await mount({ logoSrc: LOGO });
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(closeWindow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(closeWindow).toHaveBeenCalledTimes(1);
    // ⚠ NEITHER OP TAKES A TARGET. Main resolves the window from the SENDER, so an argument
    // appearing here would mean a window id had started crossing the bridge.
    expect(toggleMaximize.mock.calls[0]).toEqual([]);
    expect(closeWindow.mock.calls[0]).toEqual([]);
  });

  it("are NAKED glyphs — no button face, muted at rest", async () => {
    installBridge();
    await mount({ logoSrc: LOGO });
    for (const name of ["Expand", "Close"]) {
      const btn = screen.getByRole("button", { name });
      expect(btn.className).toContain("text-text-muted");
      expect(btn.className).toContain("hover:text-text-primary");
      // `bare` suppresses both the resting surface and the pressed raise.
      expect(btn.className).not.toContain("btn-light");
      expect(btn.className).not.toContain("raised-tab");
      expect(btn.className).not.toContain("border");
      // 30px hit area around an 18px glyph.
      expect(btn.className).toContain("h-[30px]");
      expect(btn.querySelector("svg")?.getAttribute("width")).toBe("18");
    }
  });

  it("render NOT AT ALL on a build whose bridge cannot move the window", async () => {
    // A plain browser, or a main predating `main/window-chrome.js`. An inert close button looks
    // exactly like a working one — the rule the composer's own absence follows.
    installBridge({ withWindowChrome: false });
    await mount({ logoSrc: LOGO });
    expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

describe("the frameless window's drag region", () => {
  it("the BAR drags and the control group opts OUT", () => {
    expect(CODE).toContain("WebkitAppRegion: \"drag\"");
    expect(CODE).toContain("WebkitAppRegion: \"no-drag\"");
    // The header takes the drag region; the right-hand group takes `no-drag`. A button inside a
    // drag region never sees the click.
    expect(CODE).toMatch(/<header\s+style=\{DRAG_REGION\}/);
    expect(CODE).toMatch(/<span style=\{NO_DRAG_REGION\}/);
  });
});
