import { describe, it, expect } from "vitest";
import {
  DEFAULT_STUB,
  chooseRouting,
  labelAnchor,
  routeEdges,
} from "./route-edges";
import type { NodeRect, Point, SceneEdge } from "./types";

function rect(x: number, y: number, width = 100, height = 50): NodeRect {
  return { x, y, width, height };
}

function edge(from: string, to: string, kind = "sequence", label?: string): SceneEdge {
  return { id: `${from}->${to}`, kind, from, to, label };
}

function firstStubLen(points: Point[]): number {
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
}

describe("chooseRouting", () => {
  it("routes right→left when the target is to the right", () => {
    expect(chooseRouting(rect(0, 0), rect(200, 0))).toMatchObject({
      orient: "H",
      fromSide: "right",
      toSide: "left",
    });
  });

  it("routes left→right when the target is to the left", () => {
    expect(chooseRouting(rect(200, 0), rect(0, 0))).toMatchObject({
      orient: "H",
      fromSide: "left",
      toSide: "right",
    });
  });

  it("routes bottom→top when the target is below", () => {
    expect(chooseRouting(rect(0, 0), rect(0, 200))).toMatchObject({
      orient: "V",
      fromSide: "bottom",
      toSide: "top",
    });
  });

  it("routes top→bottom when the target is above", () => {
    expect(chooseRouting(rect(0, 200), rect(0, 0))).toMatchObject({
      orient: "V",
      fromSide: "top",
      toSide: "bottom",
    });
  });

  it("keeps horizontal for a slight vertical offset (hysteresis)", () => {
    expect(chooseRouting(rect(0, 0), rect(200, 20)).orient).toBe("H");
  });
});

describe("routeEdges", () => {
  it("anchors the polyline exactly on the source right and target left borders", () => {
    const rects = { A: rect(0, 0), B: rect(300, 0) };
    const [routed] = routeEdges([edge("A", "B")], rects);
    const pts = routed.points!;
    expect(pts[0].x).toBe(100); // A right border
    expect(pts[pts.length - 1].x).toBe(300); // B left border
  });

  it("keeps at least the min stub before the first turn", () => {
    const rects = { A: rect(0, 0), B: rect(300, 80) };
    const [routed] = routeEdges([edge("A", "B")], rects);
    expect(firstStubLen(routed.points!)).toBeGreaterThanOrEqual(DEFAULT_STUB);
  });

  it("fans two parallel edges in one corridor onto distinct lanes", () => {
    const rects = {
      A: rect(0, 0),
      B: rect(300, 0),
      C: rect(300, 140),
    };
    const routed = routeEdges([edge("A", "B"), edge("A", "C")], rects);
    const riserX = (e: SceneEdge) => e.points![1].x;
    expect(riserX(routed[0])).not.toBe(riserX(routed[1]));
  });

  it("side-loops a vertical run blocked by an intervening card", () => {
    const rects = {
      col: rect(0, 0, 100, 50),
      card1: rect(10, 120, 80, 50),
      card2: rect(10, 240, 80, 50),
    };
    const [routed] = routeEdges([edge("col", "card2")], rects);
    const pts = routed.points!;
    expect(pts[0].x).toBe(0); // exits the column's LEFT border
    expect(pts[1].x).toBeLessThan(0); // side corridor left of everything
    expect(routed.fromSide).toBe("left");
  });

  it("drops edges whose endpoints are missing", () => {
    expect(routeEdges([edge("A", "ghost")], { A: rect(0, 0) })).toHaveLength(0);
  });

  it("is deterministic", () => {
    const rects = { A: rect(0, 0), B: rect(300, 0), C: rect(300, 140) };
    const edges = [edge("A", "B"), edge("A", "C")];
    expect(routeEdges(edges, rects)).toEqual(routeEdges(edges, rects));
  });
});

describe("labelAnchor", () => {
  it("sits on the midpoint of the longest horizontal segment, never a corner", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 100 },
    ];
    const anchor = labelAnchor(points);
    expect(anchor).toEqual({ x: 100, y: 50 });
    expect(points).not.toContainEqual(anchor);
  });

  it("falls back to the longest segment midpoint when nothing is horizontal", () => {
    expect(labelAnchor([{ x: 0, y: 0 }, { x: 0, y: 100 }])).toEqual({ x: 0, y: 50 });
  });
});
