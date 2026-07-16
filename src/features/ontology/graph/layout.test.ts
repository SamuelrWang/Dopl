import { describe, it, expect } from "vitest";
import type { GraphState } from "../graph-state";
import type { ObjectAttribute, OntologyCluster, OntologyObject } from "../types";
import { deriveScene } from "./derive";
import {
  DEFAULT_HEIGHT,
  LANE_PITCH,
  MARGIN,
  MIN_WORLD_HEIGHT,
  MIN_WORLD_WIDTH,
  OBJECT_WIDTH,
  TOP_Y,
  VGAP,
  VGAP_FIRST,
  layoutScene,
  routeEdges,
} from "./layout";

function object(id: string, overrides: Partial<OntologyObject> = {}): OntologyObject {
  return {
    id,
    name: id,
    subtitle: "",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: [],
    template: [],
    ...overrides,
  };
}

function cluster(id: string, columnIds: string[]): OntologyCluster {
  return { id, slug: id, name: id, purpose: "", columnIds };
}

function graph(clusters: OntologyCluster[], objects: OntologyObject[]): GraphState {
  return { clusters, objects: Object.fromEntries(objects.map((o) => [o.id, o])) };
}

function refAttr(key: string, label: string, ids: string[]): ObjectAttribute {
  return { key, label, value: { kind: "ref", value: ids } };
}

function sampleGraph(): GraphState {
  return graph(
    [cluster("cl", ["colA", "colB"])],
    [
      object("colA", { childIds: ["a1", "a2"] }),
      object("a1", {
        childIds: ["a1c"],
        relationships: [{ label: "sib", targetIds: ["a2"] }],
      }),
      object("a1c"),
      object("a2"),
      object("colB", { childIds: ["b1"] }),
      object("b1", {
        attributes: [refAttr("campaign", "Campaign", ["a1"])],
        relationships: [{ label: "rel", targetIds: ["a1", "a2"] }],
      }),
    ],
  );
}

describe("layoutScene positions", () => {
  it("places columns in one top row spaced by lane pitch", () => {
    const scene = deriveScene(sampleGraph(), "cl");
    const layout = layoutScene(scene, {});

    expect(layout.positions.colA).toEqual({ x: MARGIN, y: TOP_Y, width: 240 });
    expect(layout.positions.colB).toEqual({ x: MARGIN + LANE_PITCH, y: TOP_Y, width: 240 });
  });

  it("stacks lane objects with the first-child gap then the inter-child gap", () => {
    const scene = deriveScene(sampleGraph(), "cl");
    const layout = layoutScene(scene, {});

    const firstY = TOP_Y + DEFAULT_HEIGHT + VGAP_FIRST;
    const secondY = firstY + DEFAULT_HEIGHT + VGAP;
    const thirdY = secondY + DEFAULT_HEIGHT + VGAP;

    expect(layout.positions.a1.y).toBe(firstY);
    expect(layout.positions.a1c.y).toBe(secondY);
    expect(layout.positions.a2.y).toBe(thirdY);
    expect(layout.positions.a1.x).toBe(MARGIN + (240 - OBJECT_WIDTH) / 2);
    expect(layout.positions.a1.width).toBe(OBJECT_WIDTH);
  });

  it("is total — every node gets a position even with no measured heights", () => {
    const scene = deriveScene(sampleGraph(), "cl");
    const layout = layoutScene(scene, {});

    for (const node of scene.nodes) {
      expect(layout.positions[node.id]).toBeDefined();
    }
  });

  it("honours measured heights when stacking", () => {
    const scene = deriveScene(sampleGraph(), "cl");
    const layout = layoutScene(scene, { colA: 300, a1: 500 });

    expect(layout.positions.a1.y).toBe(TOP_Y + 300 + VGAP_FIRST);
    expect(layout.positions.a1c.y).toBe(layout.positions.a1.y + 500 + VGAP);
  });

  it("enforces world minimums for an empty scene", () => {
    const layout = layoutScene({ nodes: [], edges: [] }, {});

    expect(layout.worldWidth).toBe(MIN_WORLD_WIDTH);
    expect(layout.worldHeight).toBe(MIN_WORLD_HEIGHT);
  });
});

describe("routeEdges hints", () => {
  it("routes the first child vertically and later children through a left loop", () => {
    const scene = deriveScene(sampleGraph(), "cl");
    const layout = layoutScene(scene, {});
    const edges = routeEdges(scene, layout);

    const first = edges.find((e) => e.id === "c:colA:a1");
    const second = edges.find((e) => e.id === "c:colA:a2");

    expect(first).toMatchObject({ fromSide: "bottom", toSide: "top" });
    expect(second).toMatchObject({ fromSide: "left", toSide: "left" });
    expect(second?.mid).toBe(layout.positions.a2.x - 60);
  });

  it("routes same-lane relationships vertically by direction", () => {
    const scene = deriveScene(sampleGraph(), "cl");
    const layout = layoutScene(scene, {});
    const edges = routeEdges(scene, layout);

    const sib = edges.find((e) => e.id === "r:a1:sib:a2");
    expect(sib).toMatchObject({ fromSide: "bottom", toSide: "top" });
  });

  it("routes cross-lane relationships out the side toward the target", () => {
    const scene = deriveScene(sampleGraph(), "cl");
    const layout = layoutScene(scene, {});
    const edges = routeEdges(scene, layout);

    const toA1 = edges.find((e) => e.id === "r:b1:rel:a1");
    expect(toA1?.fromSide).toBe("left");
    expect(toA1?.toSide).toBe("right");
    expect(toA1?.mid).toBeGreaterThan(MARGIN + 240);
    expect(toA1?.mid).toBeLessThan(MARGIN + LANE_PITCH);
  });

  it("staggers parallel cross-lane edges so their mids differ", () => {
    const scene = deriveScene(sampleGraph(), "cl");
    const layout = layoutScene(scene, {});
    const edges = routeEdges(scene, layout);

    const toA1 = edges.find((e) => e.id === "r:b1:rel:a1");
    const toA2 = edges.find((e) => e.id === "r:b1:rel:a2");

    expect(toA1?.mid).toBeDefined();
    expect(toA2?.mid).toBeDefined();
    expect(toA1?.mid).not.toBe(toA2?.mid);
  });

  it("routes ref edges through the clear lane below all content", () => {
    const scene = deriveScene(sampleGraph(), "cl");
    const layout = layoutScene(scene, {});
    const edges = routeEdges(scene, layout);

    const ref = edges.find((e) => e.kind === "ref");
    expect(ref).toMatchObject({ fromSide: "bottom", toSide: "bottom" });
    expect(ref?.mid).toBe(layout.worldHeight - 60);
  });

  it("assigns hints deterministically and without mutating the scene", () => {
    const scene = deriveScene(sampleGraph(), "cl");
    const layout = layoutScene(scene, {});

    const first = routeEdges(scene, layout);
    const second = routeEdges(scene, layout);

    expect(first).toEqual(second);
    expect(scene.edges.every((e) => e.fromSide === undefined)).toBe(true);
  });
});
