import { describe, it, expect } from "vitest";
import {
  autoScrollDelta,
  exceededThreshold,
  snap,
  snapPoint,
} from "./drag-math";

describe("snap", () => {
  it("rounds to the nearest grid step", () => {
    expect(snap(11, 8)).toBe(8);
    expect(snap(13, 8)).toBe(16);
    expect(snap(-20, 8)).toBe(-16);
    expect(snap(-28, 8)).toBe(-24);
  });

  it("passes the value through when the grid is disabled", () => {
    expect(snap(13, 0)).toBe(13);
    expect(snap(13, -1)).toBe(13);
  });

  it("snaps both axes of a point", () => {
    expect(snapPoint({ x: 11, y: 20 }, 8)).toEqual({ x: 8, y: 24 });
  });
});

describe("exceededThreshold", () => {
  it("is false below and true at/above the threshold distance", () => {
    expect(exceededThreshold(2, 2, 4)).toBe(false); // hypot ~2.83
    expect(exceededThreshold(3, 4, 4)).toBe(true); // hypot 5
    expect(exceededThreshold(4, 0, 4)).toBe(true);
  });
});

describe("autoScrollDelta", () => {
  const rect = { left: 0, top: 0, width: 400, height: 300 };

  it("is zero when the pointer is comfortably inside", () => {
    expect(autoScrollDelta({ x: 200, y: 150 }, rect)).toEqual({ x: 0, y: 0 });
  });

  it("scrolls left/up near the top-left edge", () => {
    const d = autoScrollDelta({ x: 2, y: 2 }, rect);
    expect(d.x).toBeLessThan(0);
    expect(d.y).toBeLessThan(0);
  });

  it("scrolls right/down near the bottom-right edge", () => {
    const d = autoScrollDelta({ x: 398, y: 298 }, rect);
    expect(d.x).toBeGreaterThan(0);
    expect(d.y).toBeGreaterThan(0);
  });

  it("caps at the max speed", () => {
    const d = autoScrollDelta({ x: -100, y: 150 }, rect, 36, 14);
    expect(d.x).toBe(-14);
  });
});
