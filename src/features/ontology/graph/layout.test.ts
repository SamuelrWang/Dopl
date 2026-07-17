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
  return { id, slug: id, name: id, purpose: "", columnIds, layout: {} };
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
