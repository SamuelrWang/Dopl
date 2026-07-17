import { describe, it, expect } from "vitest";
import type { NodeRect } from "@/shared/graph";
import { clientToWorld, hitTestNode, portAnchor, previewPoints } from "./ports";

const rect: NodeRect = { x: 100, y: 80, width: 200, height: 60 };

describe("portAnchor", () => {
  it("anchors the right (output) port on the mid of the right edge", () => {
    expect(portAnchor(rect, "right")).toEqual({ x: 300, y: 110 });
  });

  it("anchors the left (input) port on the mid of the left edge", () => {
    expect(portAnchor(rect, "left")).toEqual({ x: 100, y: 110 });
  });
});

describe("hitTestNode", () => {
  const rects: Record<string, NodeRect> = {
    a: { x: 0, y: 0, width: 100, height: 100 },
    b: { x: 200, y: 0, width: 100, height: 100 },
  };

  it("returns the node whose rect contains the point", () => {
    expect(hitTestNode({ x: 50, y: 50 }, rects)).toBe("a");
    expect(hitTestNode({ x: 250, y: 50 }, rects)).toBe("b");
  });

  it("returns null over empty substrate", () => {
    expect(hitTestNode({ x: 150, y: 50 }, rects)).toBeNull();
  });

  it("excludes the drag source even when the point is inside it", () => {
    expect(hitTestNode({ x: 50, y: 50 }, rects, "a")).toBeNull();
  });

  it("includes the node's border (inclusive edges)", () => {
    expect(hitTestNode({ x: 100, y: 100 }, rects)).toBe("a");
  });

  it("prefers the last (topmost) rect when two overlap", () => {
    const overlap: Record<string, NodeRect> = {
      under: { x: 0, y: 0, width: 100, height: 100 },
      over: { x: 50, y: 50, width: 100, height: 100 },
    };
    expect(hitTestNode({ x: 60, y: 60 }, overlap)).toBe("over");
  });
});

describe("previewPoints", () => {
  it("draws a horizontal-first elbow through the midpoint", () => {
    expect(previewPoints({ x: 0, y: 0 }, { x: 100, y: 40 })).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 40 },
    ]);
  });
});

describe("clientToWorld", () => {
  it("maps a client point into world coords accounting for scroll", () => {
    const frame = { left: 20, top: 10, scrollLeft: 100, scrollTop: 50 };
    expect(clientToWorld(120, 60, frame)).toEqual({ x: 200, y: 100 });
  });
});
