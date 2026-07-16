import { describe, it, expect } from "vitest";
import type { GraphState } from "../graph-state";
import type { ObjectAttribute, OntologyCluster, OntologyObject } from "../types";
import { deriveScene } from "./derive";

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

describe("deriveScene nodes", () => {
  it("emits columns then DFS descendants tagged with their root column", () => {
    const g = graph(
      [cluster("cl", ["colA", "colB"])],
      [
        object("colA", { childIds: ["a1", "a2"] }),
        object("a1", { childIds: ["a1c"] }),
        object("a1c"),
        object("a2"),
        object("colB", { childIds: ["b1"] }),
        object("b1"),
      ],
    );

    const scene = deriveScene(g, "cl");

    expect(scene.nodes.map((n) => n.id)).toEqual(["colA", "a1", "a1c", "a2", "colB", "b1"]);
    expect(scene.nodes.map((n) => n.kind)).toEqual([
      "column",
      "object",
      "object",
      "object",
      "column",
      "object",
    ]);
    expect(scene.nodes.map((n) => n.columnId)).toEqual([
      "colA",
      "colA",
      "colA",
      "colA",
      "colB",
      "colB",
    ]);
  });

  it("returns an empty scene for an unknown or empty cluster", () => {
    expect(deriveScene(graph([], []), "missing")).toEqual({ nodes: [], edges: [] });
    expect(deriveScene(graph([cluster("cl", [])], []), "cl")).toEqual({ nodes: [], edges: [] });
  });

  it("skips missing objects and guards childId cycles", () => {
    const g = graph(
      [cluster("cl", ["colA", "ghost"])],
      [
        object("colA", { childIds: ["a1", "gone"] }),
        object("a1", { childIds: ["colA"] }),
      ],
    );

    const scene = deriveScene(g, "cl");

    expect(scene.nodes.map((n) => n.id)).toEqual(["colA", "a1"]);
  });
});

describe("deriveScene edges", () => {
  it("adds containment edges for in-scene parent/child pairs", () => {
    const g = graph(
      [cluster("cl", ["colA"])],
      [object("colA", { childIds: ["a1", "a2"] }), object("a1"), object("a2")],
    );

    const containment = deriveScene(g, "cl").edges.filter((e) => e.kind === "containment");

    expect(containment.map((e) => e.id)).toEqual(["c:colA:a1", "c:colA:a2"]);
  });

  it("keeps in-scene relationships and skips off-cluster targets and self-loops", () => {
    const g = graph(
      [cluster("cl", ["colA", "colB"])],
      [
        object("colA", { childIds: ["a1"] }),
        object("a1", {
          relationships: [
            { label: "links", targetIds: ["b1", "outside", "a1"] },
          ],
        }),
        object("colB", { childIds: ["b1"] }),
        object("b1"),
        object("outside"),
      ],
    );

    const rels = deriveScene(g, "cl").edges.filter((e) => e.kind === "relationship");

    expect(rels).toEqual([
      { id: "r:a1:links:b1", kind: "relationship", from: "a1", to: "b1", label: "links" },
    ]);
  });

  it("turns ref attributes into edges but never knowledge or skill attributes", () => {
    const g = graph(
      [cluster("cl", ["colA", "colB"])],
      [
        object("colA", { childIds: ["a1"] }),
        object("a1", {
          attributes: [
            refAttr("campaign", "Campaign", ["b1"]),
            { key: "play", label: "Playbook", value: { kind: "knowledge", value: ["b1"] } },
            { key: "sk", label: "Skill", value: { kind: "skill", value: ["b1"] } },
          ],
        }),
        object("colB", { childIds: ["b1"] }),
        object("b1"),
      ],
    );

    const edges = deriveScene(g, "cl").edges;
    const refs = edges.filter((e) => e.kind === "ref");

    expect(refs).toEqual([
      { id: "f:a1:campaign:b1", kind: "ref", from: "a1", to: "b1", label: "Campaign" },
    ]);
  });

  it("produces deterministic output across repeated derivations", () => {
    const g = graph(
      [cluster("cl", ["colA", "colB"])],
      [
        object("colA", { childIds: ["a1"] }),
        object("a1", { relationships: [{ label: "rel", targetIds: ["b1"] }] }),
        object("colB", { childIds: ["b1"] }),
        object("b1", { attributes: [refAttr("r", "R", ["a1"])] }),
      ],
    );

    expect(deriveScene(g, "cl")).toEqual(deriveScene(g, "cl"));
  });
});
