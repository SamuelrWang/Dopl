// @vitest-environment jsdom
// The Activity rail's divider: a drag and an arrow key both move `--rail-layout-w` on the row,
// inside its limits, and the width is remembered per device. `getBoundingClientRect` is stubbed on
// the prototype because the hook measures the row inside the initial commit.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  IdentityRailResizeHandle,
  RAIL_RESIZE_LABEL,
  RAIL_WIDTH_DEFAULT,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  RAIL_WIDTH_STORAGE_KEY,
} from "./identity-rail-resize";

const ROW = 1200;

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: ROW,
    height: 800,
    top: 0,
    left: 0,
    right: ROW,
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

function mount() {
  const { container } = render(
    <div data-testid="row">
      <IdentityRailResizeHandle />
    </div>
  );
  const row = container.querySelector<HTMLElement>('[data-testid="row"]')!;
  const strip = screen.getByRole("separator", { name: RAIL_RESIZE_LABEL });
  return { row, strip };
}

const applied = (row: HTMLElement) => row.style.getPropertyValue("--rail-layout-w");

describe("the Activity rail divider", () => {
  it("opens at the default width", () => {
    const { row } = mount();
    expect(applied(row)).toBe(`${RAIL_WIDTH_DEFAULT}px`);
  });

  it("drags: the rail is right of the handle, so moving left widens it, within the limits", () => {
    const { row, strip } = mount();
    fireEvent.pointerDown(strip, { button: 0, pointerId: 1, clientX: ROW - RAIL_WIDTH_DEFAULT });
    fireEvent.pointerMove(strip, { pointerId: 1, clientX: ROW - 400 });
    expect(applied(row)).toBe("400px");
    fireEvent.pointerMove(strip, { pointerId: 1, clientX: 0 });
    expect(applied(row)).toBe(`${RAIL_WIDTH_MAX}px`);
    fireEvent.pointerMove(strip, { pointerId: 1, clientX: ROW });
    expect(applied(row)).toBe(`${RAIL_WIDTH_MIN}px`);
    fireEvent.pointerUp(strip, { pointerId: 1 });
    expect(window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBe(String(RAIL_WIDTH_MIN));
  });

  it("takes the arrow keys and remembers the width across a remount", () => {
    const { row, strip } = mount();
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(applied(row)).toBe(`${RAIL_WIDTH_DEFAULT + 16}px`);
    cleanup();
    const again = mount();
    expect(applied(again.row)).toBe(`${RAIL_WIDTH_DEFAULT + 16}px`);
  });
});
