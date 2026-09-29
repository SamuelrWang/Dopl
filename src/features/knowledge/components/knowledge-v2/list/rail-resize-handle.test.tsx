// @vitest-environment jsdom
/**
 * THE KNOWLEDGE RAIL'S DRAG BAR (Samuel, 2026-09-29) — the channel's bar,
 * rebound: the rail is LEFT of the handle, so it grows RIGHTWARD off the body's
 * left edge, and ArrowRight widens it. The pill's own face is pinned once, in
 * `channels/components/info-resize-handle.test.tsx`; this file holds the rail's
 * config — the limits, the direction and the memory.
 *
 * ⚠ `getBoundingClientRect` IS STUBBED ON THE PROTOTYPE: the hook measures in a
 * ref callback during the first commit, before a test could reach the node.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  RAIL_RESIZE_LABEL,
  RAIL_WIDTH_DEFAULT,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  RAIL_WIDTH_STORAGE_KEY,
  RailResizeHandle,
} from "./rail-resize-handle";

/** A 1200px body whose left edge is at 100. */
const LEFT = 100;
let bodyWidth = 1200;

beforeEach(() => {
  window.localStorage.clear();
  bodyWidth = 1200;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        width: bodyWidth,
        height: 800,
        top: 0,
        left: LEFT,
        right: LEFT + bodyWidth,
        bottom: 800,
        x: LEFT,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount() {
  const { container } = render(
    <div data-testid="base-body">
      <div />
      <RailResizeHandle />
      <div />
    </div>
  );
  const root = container.querySelector<HTMLElement>('[data-testid="base-body"]')!;
  const strip = screen.getByRole("separator", { name: RAIL_RESIZE_LABEL });
  return { root, strip };
}

const applied = (root: HTMLElement) => root.style.getPropertyValue("--kv-rail-w");

describe("the rail's drag bar", () => {
  it("states 180–420 and starts at today's 232", () => {
    expect([RAIL_WIDTH_MIN, RAIL_WIDTH_DEFAULT, RAIL_WIDTH_MAX]).toEqual([180, 232, 420]);
    const { root, strip } = mount();
    expect(applied(root)).toBe("232px");
    expect(strip.getAttribute("aria-valuemin")).toBe("180");
    expect(strip.getAttribute("aria-valuemax")).toBe("420");
    expect(strip.getAttribute("aria-orientation")).toBe("vertical");
    expect(strip.tabIndex).toBe(0);
  });

  it("tracks the pointer RIGHTWARD off the body's left edge, clamped both ways", () => {
    const { root, strip } = mount();
    fireEvent.pointerDown(strip, { button: 0, clientX: LEFT + 232 });
    expect(root.getAttribute("data-kv-rail-resizing")).toBe("true");
    fireEvent.pointerMove(strip, { clientX: LEFT + 300 });
    expect(applied(root)).toBe("300px");
    fireEvent.pointerMove(strip, { clientX: LEFT + 900 });
    expect(applied(root)).toBe("420px");
    fireEvent.pointerMove(strip, { clientX: LEFT + 20 });
    expect(applied(root)).toBe("180px");
    fireEvent.pointerUp(strip);
    expect(root.hasAttribute("data-kv-rail-resizing")).toBe(false);
    expect(window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBe("180");
  });

  it("never takes more than half a narrow body", () => {
    bodyWidth = 600;
    const { root, strip } = mount();
    fireEvent.pointerDown(strip, { button: 0, clientX: LEFT + 232 });
    fireEvent.pointerMove(strip, { clientX: LEFT + 500 });
    expect(applied(root)).toBe("300px");
  });

  it("ArrowRight widens, ArrowLeft narrows — the divider moves the way the arrow points", () => {
    const { root, strip } = mount();
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(applied(root)).toBe("248px");
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(applied(root)).toBe("216px");
    expect(window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBe("216");
  });

  it("restores the remembered width on the next mount", () => {
    window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, "360");
    const { root } = mount();
    expect(applied(root)).toBe("360px");
  });
});
