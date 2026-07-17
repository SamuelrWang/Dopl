import { describe, it, expect } from "vitest";
import {
  mergeStoredLayout,
  placeNewNode,
  pruneLayout,
  resolvePositions,
  worldBounds,
} from "./positions";
import type { GraphLayout, NodeLayout, NodeRect } from "./types";

const auto: Record<string, NodeLayout> = {
  a: { x: 0, y: 0, width: 100 },
  b: { x: 200, y: 0, width: 100 },
};

describe("resolvePositions", () => {
  it("returns the auto layout when nothing is stored", () => {
    expect(resolvePositions(auto, null)).toEqual(auto);
    expect(resolvePositions(auto, {})).toEqual(auto);
  });

  it("lets a stored position win per node, keeping the auto width", () => {
    const out = resolvePositions(auto, { a: { x: 50, y: 80 } });
    expect(out.a).toEqual({ x: 50, y: 80, width: 100 });
    expect(out.b).toEqual(auto.b);
  });

  it("ignores stored ids that are no longer in the auto layout", () => {
    const out = resolvePositions(auto, { gone: { x: 9, y: 9 } });
    expect(out).toEqual(auto);
  });

  it("ignores a non-finite stored coordinate", () => {
    const out = resolvePositions(auto, { a: { x: NaN, y: 5 } });
    expect(out.a).toEqual(auto.a);
  });
});

describe("pruneLayout", () => {
  it("keeps entries whose node is still in the auto layout", () => {
    const stored: GraphLayout = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } };
    expect(pruneLayout(stored, auto)).toEqual(stored);
  });

  it("drops entries for nodes absent from the auto layout", () => {
    const stored: GraphLayout = { a: { x: 1, y: 2 }, gone: { x: 9, y: 9 } };
    expect(pruneLayout(stored, auto)).toEqual({ a: { x: 1, y: 2 } });
  });

  it("returns an empty map when nothing survives", () => {
    expect(pruneLayout({ gone: { x: 0, y: 0 } }, auto)).toEqual({});
  });
});

describe("mergeStoredLayout", () => {
  it("replaces with {} for the empty (reset) patch, ignoring current", () => {
    expect(mergeStoredLayout({ a: { x: 1, y: 2 } }, {})).toEqual({});
  });

  it("shallow-merges a non-empty patch over the current layout by node id", () => {
    const current = { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } };
    const out = mergeStoredLayout(current, { b: { x: 9, y: 9 }, c: { x: 3, y: 3 } });
    expect(out).toEqual({
      a: { x: 1, y: 1 },
      b: { x: 9, y: 9 },
      c: { x: 3, y: 3 },
    });
  });

  it("treats a null/undefined current layout as empty", () => {
    expect(mergeStoredLayout(null, { a: { x: 1, y: 1 } })).toEqual({ a: { x: 1, y: 1 } });
    expect(mergeStoredLayout(undefined, { a: { x: 1, y: 1 } })).toEqual({ a: { x: 1, y: 1 } });
  });
});

describe("placeNewNode", () => {
  const size = { width: 100, height: 60 };

  it("returns a spot that overlaps nothing existing", () => {
    const existing: NodeRect[] = [
      { x: 0, y: 0, width: 100, height: 60 },
      { x: 0, y: 100, width: 100, height: 60 },
    ];
    const spot = placeNewNode(existing, size);
    const rect: NodeRect = { ...spot, ...size };
    const clashes = existing.some(
      (r) =>
        rect.x < r.x + r.width &&
        rect.x + rect.width > r.x &&
        rect.y < r.y + r.height &&
        rect.y + rect.height > r.y
    );
    expect(clashes).toBe(false);
  });

  it("places into empty space with no existing nodes", () => {
    const spot = placeNewNode([], size);
    expect(spot.x).toBeGreaterThanOrEqual(0);
    expect(spot.y).toBeGreaterThanOrEqual(0);
  });
});

describe("worldBounds", () => {
  it("contains every rect plus padding", () => {
    const rects: NodeRect[] = [{ x: 100, y: 100, width: 200, height: 100 }];
    expect(worldBounds(rects, 50, { width: 0, height: 0 })).toEqual({
      width: 350,
      height: 250,
    });
  });

  it("floors at the minimum for a sparse world", () => {
    expect(worldBounds([], 50, { width: 800, height: 600 })).toEqual({
      width: 800,
      height: 600,
    });
  });
});
