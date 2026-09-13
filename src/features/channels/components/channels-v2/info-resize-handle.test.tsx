// @vitest-environment jsdom
/**
 * THE DRAGGABLE DIVIDER (Samuel, 2026-09-13).
 *
 * ⚠ WHAT THIS FILE IS FOR IS THE THINGS A SCREENSHOT CANNOT SHOW. The pill either
 * looks right or it does not, and Samuel reviews that live; what a suite has to
 * hold are the four properties a later edit silently breaks:
 *
 *   • **THE TWO LIMITS, AND THEY ARE NOT SYMMETRIC.** Left stops at 50/50; right
 *     stops at the width the column has always had, which is the whole meaning of
 *     *"so that it doesn't collapse too much"*. A regression here does not throw —
 *     the pane just starts disappearing, or eats the transcript.
 *   • **THE VARIABLE IS THE MECHANISM.** Everything that follows the width reads
 *     `--info-w` off the SURFACE ROOT (the shell, the panel, the agent overlay).
 *     A drag that moved React state instead would still look right and would
 *     re-render the whole surface per frame.
 *   • **THE ARROWS ARE A FACT IN THE DOM**, not a `group-hover:` class — so this
 *     file can assert the behaviour rather than read a string back.
 *   • **THE PREFERENCE SURVIVES A REMOUNT**, per device.
 *
 * ⚠ `getBoundingClientRect` IS STUBBED ON THE PROTOTYPE, not on one node, and the
 * TIMING is why: the hook resolves the surface root and applies the remembered
 * width in a REF CALLBACK, which runs inside the initial commit — before a test
 * could reach the node to stub it. jsdom measures everything as 0, and a 0-wide
 * surface has no range at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DIVIDER_WIDTH_VAR,
  InfoResizeHandle,
  INFO_RESIZE_LABEL,
} from "./info-resize-handle";
import { INFO_WIDTH_STORAGE_KEY } from "./use-info-resize";

/** A 1200px surface whose right edge is at 1200 — so max = 600, min = 380. */
const SURFACE = 1200;
const MIN = 380;
const MAX = SURFACE / 2;

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: SURFACE,
    height: 800,
    top: 0,
    left: 0,
    right: SURFACE,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The handle's wrapper is a DIRECT CHILD of the surface root on both hosts —
 *  `channel-surface.tsx` is a fragment — so this is that root. */
function mount() {
  const { container } = render(
    <div data-testid="surface-root">
      <InfoResizeHandle />
    </div>
  );
  const root = container.querySelector<HTMLElement>(
    '[data-testid="surface-root"]'
  )!;
  const strip = screen.getByRole("separator", { name: INFO_RESIZE_LABEL });
  return { root, strip, container };
}

const applied = (root: HTMLElement) => root.style.getPropertyValue("--info-w");

describe("the handle itself", () => {
  it("is a centred pill over the divider, with separator semantics", () => {
    const { strip, container } = mount();
    // ⚠ THE HIT AREA AND THE PILL ARE DIFFERENT BOXES ON PURPOSE: a 4px target is
    // not a target. The strip is 12px and invisible; the pill is what is seen.
    expect(strip.className).toContain("w-3");
    expect(strip.className).toContain("cursor-col-resize");
    const pill = container.querySelector<HTMLElement>("[data-resize-pill]");
    expect(pill).toBeTruthy();
    expect(pill!.className).toContain("w-1");
    expect(pill!.className).toContain("h-10");
    expect(pill!.className).toContain("rounded-full");
    // Token black, never a hex — docs/DESIGN-SYSTEM.md.
    expect(pill!.className).toContain("bg-text-primary");
    expect(strip.getAttribute("aria-orientation")).toBe("vertical");
    expect(strip.getAttribute("aria-valuenow")).toBe(String(MIN));
    expect(strip.getAttribute("aria-valuemin")).toBe(String(MIN));
    expect(strip.getAttribute("aria-valuemax")).toBe(String(MAX));
    expect(strip.tabIndex).toBe(0);
  });

  /**
   * 🔒 **THE PILL'S CENTRE IS THE LINE'S CENTRE (Samuel, 2026-09-13):** *"for the
   * black vertical line that we're using so that the user can use it to drag …
   * right now it's sitting to the left. I want it to be perfectly on the vertical
   * line."*
   *
   * ⚠ **THE ARITHMETIC IS THE TEST, because jsdom computes no CSS.** The wrapper is
   * `w-0`, so its x IS the info column's left edge — which is the divider's FIRST
   * pixel (`info-panel.tsx › border-l border-border-default`, drawn inside the
   * column), not its middle. With `left-1/2` that resolved to 0 and
   * `-translate-x-1/2` centred the 12px strip — and the 4px pill inside it — on
   * that edge: half the pill sat on the transcript. `left` must therefore be HALF A
   * BORDER, so:
   *
   *     pill centre = 0 + w/2 − 12/2 + 12/2 = w/2 = the line's centre  ✓
   *
   * ⚠ **AND THE BORDER IS TWO WIDTHS**, which is why the offset is a VARIABLE: 1px
   * on the workspace channels page, 2px inside /home's record pane. The /home half
   * is pinned in `apps/desktop-ui/src/pages/home/channel-divider.test.ts`, which
   * reads the module that widens it.
   */
  it("offsets the strip by HALF the divider, so the pill lands on the line's centre", () => {
    const { strip } = mount();
    // ⚠ THE EXPRESSION, LITERALLY: Tailwind scans source text, so an interpolated
    // class is a rule that never gets generated — and a missing `left` silently
    // puts the pill back where the bug was.
    expect(strip.className).toContain(`left-[calc(var(${DIVIDER_WIDTH_VAR},1px)/2)]`);
    expect(strip.className).toContain("-translate-x-1/2");
    // ⚠ AND NOT `left-1/2`, which is the bug's own class.
    expect(strip.className).not.toMatch(/\bleft-1\/2\b/);
    // The pill is centred inside that strip and owns no offset of its own.
    const pill = strip.querySelector("[data-resize-pill]") as HTMLElement;
    expect(pill.className).not.toMatch(/\b-?m[lrx]-/);
  });

  it("shows the two chevrons on hover, and takes them back", () => {
    const { strip, container } = mount();
    const arrows = () => container.querySelectorAll("[data-resize-arrow]");
    expect(arrows()).toHaveLength(0);
    fireEvent.pointerEnter(strip);
    expect([...arrows()].map((a) => a.getAttribute("data-resize-arrow"))).toEqual(
      ["left", "right"]
    );
    fireEvent.pointerLeave(strip);
    expect(arrows()).toHaveLength(0);
  });

  it("shows them on FOCUS too — the keyboard path is the same control", () => {
    const { strip, container } = mount();
    fireEvent.focus(strip);
    expect(container.querySelectorAll("[data-resize-arrow]")).toHaveLength(2);
  });
});

describe("dragging moves ONE variable on the surface root", () => {
  it("tracks the pointer, and hands the drag a transition-free column", () => {
    const { root, strip } = mount();
    fireEvent.pointerDown(strip, { button: 0, clientX: SURFACE - MIN });
    // The 200ms width transition stands down for the length of the gesture.
    expect(root.getAttribute("data-info-resizing")).toBe("true");
    fireEvent.pointerMove(strip, { clientX: 800 });
    expect(applied(root)).toBe("400px");
    fireEvent.pointerMove(strip, { clientX: 750 });
    expect(applied(root)).toBe("450px");
    fireEvent.pointerUp(strip);
    expect(root.hasAttribute("data-info-resizing")).toBe(false);
  });

  it("stops LEFT at 50/50 with the transcript", () => {
    const { root, strip } = mount();
    fireEvent.pointerDown(strip, { button: 0, clientX: SURFACE - MIN });
    // Far past the middle of the surface — the pane may not pass half.
    fireEvent.pointerMove(strip, { clientX: 100 });
    expect(applied(root)).toBe(`${MAX}px`);
    expect(strip.getAttribute("aria-valuenow")).toBe(String(MAX));
  });

  it("stops RIGHT at today's width — it never collapses further", () => {
    const { root, strip } = mount();
    fireEvent.pointerDown(strip, { button: 0, clientX: SURFACE - MIN });
    fireEvent.pointerMove(strip, { clientX: SURFACE - 40 });
    expect(applied(root)).toBe(`${MIN}px`);
  });

  it("ignores a non-primary button", () => {
    const { root, strip } = mount();
    fireEvent.pointerDown(strip, { button: 2, clientX: 900 });
    fireEvent.pointerMove(strip, { clientX: 700 });
    expect(root.hasAttribute("data-info-resizing")).toBe(false);
    expect(applied(root)).toBe(`${MIN}px`);
  });
});

describe("the keyboard moves it too", () => {
  it("nudges 16px per press, LEFT widening the pane as the drag does", () => {
    const { root, strip } = mount();
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(applied(root)).toBe("396px");
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(applied(root)).toBe("412px");
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(applied(root)).toBe("396px");
    // And the floor holds against the keyboard exactly as it does against a drag.
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(applied(root)).toBe(`${MIN}px`);
  });

  it("leaves other keys alone", () => {
    const { root, strip } = mount();
    fireEvent.keyDown(strip, { key: "Enter" });
    expect(applied(root)).toBe(`${MIN}px`);
  });
});

describe("the width is remembered per device", () => {
  it("persists on release and restores on the next mount", () => {
    const first = mount();
    fireEvent.pointerDown(first.strip, { button: 0, clientX: SURFACE - MIN });
    fireEvent.pointerMove(first.strip, { clientX: 700 });
    fireEvent.pointerUp(first.strip);
    expect(window.localStorage.getItem(INFO_WIDTH_STORAGE_KEY)).toBe("500");
    cleanup();
    const second = mount();
    // ⚠ APPLIED IN THE COMMIT, so the column never paints at 380 and then slides.
    expect(applied(second.root)).toBe("500px");
    expect(second.strip.getAttribute("aria-valuenow")).toBe("500");
  });

  it("persists a keyboard nudge without waiting for a pointer", () => {
    const { strip } = mount();
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(window.localStorage.getItem(INFO_WIDTH_STORAGE_KEY)).toBe("396");
  });

  it("clamps a stored width that no longer fits, and keeps the preference", () => {
    // Remembered on a wide screen, restored on a narrow one.
    window.localStorage.setItem(INFO_WIDTH_STORAGE_KEY, "900");
    const { root, strip } = mount();
    expect(applied(root)).toBe(`${MAX}px`);
    // ⚠ THE CLAMP MUST NOT SPEND THE CHOICE: widen the window and the pane comes
    // back to what was asked for, which is only possible if 900 survived it.
    expect(strip.getAttribute("aria-valuenow")).toBe(String(MAX));
    fireEvent.resize(window);
    expect(applied(root)).toBe(`${MAX}px`);
    expect(window.localStorage.getItem(INFO_WIDTH_STORAGE_KEY)).toBe("900");
  });

  it("falls back to today's width when nothing is stored or it is junk", () => {
    window.localStorage.setItem(INFO_WIDTH_STORAGE_KEY, "not-a-number");
    const { root } = mount();
    expect(applied(root)).toBe(`${MIN}px`);
  });
});
