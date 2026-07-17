import { describe, it, expect } from "vitest";
import type { WorkflowStep } from "../types";
import {
  CARD_WIDTH,
  COL_PITCH,
  MARGIN_X,
  MIN_WORLD_HEIGHT,
  MIN_WORLD_WIDTH,
  TOP_Y,
  VGAP,
  DEFAULT_HEIGHT,
  layoutWorkflow,
  rankWorkflow,
  toWorkflowSceneEdges,
} from "./layout";

function step(id: string): WorkflowStep {
  return {
    id,
    ref: id,
    title: id,
    description: "",
    reads: [],
    actions: [],
    userInput: "",
    agentOutput: "",
    nextInstructions: "",
  };
}

function edge(from: string, to: string, condition = "") {
  return { from, to, condition };
}

describe("rankWorkflow", () => {
  it("puts an entry (indegree 0) at rank 0 and a linear chain in ascending ranks", () => {
    const { rankOf } = rankWorkflow([step("A"), step("B"), step("C")], [
      edge("A", "B"),
      edge("B", "C"),
    ]);
    expect(rankOf.get("A")).toBe(0);
    expect(rankOf.get("B")).toBe(1);
    expect(rankOf.get("C")).toBe(2);
  });

  it("uses longest path so a merge sits past its deepest predecessor", () => {
    // A → B → D and A → D. D must rank after B (longest path), not tie A→D.
    const { rankOf } = rankWorkflow([step("A"), step("B"), step("D")], [
      edge("A", "B"),
      edge("B", "D"),
      edge("A", "D"),
    ]);
    expect(rankOf.get("A")).toBe(0);
    expect(rankOf.get("B")).toBe(1);
    expect(rankOf.get("D")).toBe(2);
  });

  it("keeps multiple entries together in rank 0 and fans branches into rank 1", () => {
    // Two entries E1, E2 both into M.
    const { rankOf, ranks } = rankWorkflow([step("E1"), step("E2"), step("M")], [
      edge("E1", "M"),
      edge("E2", "M"),
    ]);
    expect(rankOf.get("E1")).toBe(0);
    expect(rankOf.get("E2")).toBe(0);
    expect(rankOf.get("M")).toBe(1);
    expect(ranks[0]).toEqual(["E1", "E2"]);
    expect(ranks[1]).toEqual(["M"]);
  });

  it("parks fully disconnected steps in a trailing rank", () => {
    const { rankOf, ranks } = rankWorkflow([step("A"), step("B"), step("LOOSE")], [
      edge("A", "B"),
    ]);
    expect(rankOf.get("A")).toBe(0);
    expect(rankOf.get("B")).toBe(1);
    // Trailing rank = maxConnectedRank + 1.
    expect(rankOf.get("LOOSE")).toBe(2);
    expect(ranks[2]).toEqual(["LOOSE"]);
  });

  it("is deterministic across calls", () => {
    const nodes = [step("A"), step("B"), step("C"), step("D")];
    const edges = [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")];
    const first = rankWorkflow(nodes, edges);
    const second = rankWorkflow(nodes, edges);
    expect(first.ranks).toEqual(second.ranks);
  });

  it("orders a rank by predecessor barycenter to reduce crossings", () => {
    // Entries P (idx0) and Q (idx1); P→Y, Q→X. Rank 1 authored [X, Y] but
    // barycenter puts Y (pred P, pos 0) before X (pred Q, pos 1).
    const { ranks } = rankWorkflow([step("P"), step("Q"), step("X"), step("Y")], [
      edge("P", "Y"),
      edge("Q", "X"),
    ]);
    expect(ranks[0]).toEqual(["P", "Q"]);
    expect(ranks[1]).toEqual(["Y", "X"]);
  });
});

describe("layoutWorkflow", () => {
  it("places ranks as left→right columns and stacks within a rank", () => {
    const layout = layoutWorkflow([step("A"), step("B"), step("C")], [
      edge("A", "B"),
      edge("A", "C"),
    ], {});

    expect(layout.positions.A).toEqual({ x: MARGIN_X, y: TOP_Y, width: CARD_WIDTH });
    // B and C share rank 1 (same x), stacked in y.
    expect(layout.positions.B.x).toBe(MARGIN_X + COL_PITCH);
    expect(layout.positions.C.x).toBe(MARGIN_X + COL_PITCH);
    expect(layout.positions.B.y).toBe(TOP_Y);
    expect(layout.positions.C.y).toBe(TOP_Y + DEFAULT_HEIGHT + VGAP);
  });

  it("honours measured heights when stacking a rank", () => {
    const layout = layoutWorkflow([step("A"), step("B"), step("C")], [
      edge("A", "B"),
      edge("A", "C"),
    ], { B: 300 });
    expect(layout.positions.C.y).toBe(TOP_Y + 300 + VGAP);
  });

  it("gives every node a position", () => {
    const nodes = [step("A"), step("B"), step("LOOSE")];
    const layout = layoutWorkflow(nodes, [edge("A", "B")], {});
    for (const n of nodes) expect(layout.positions[n.id]).toBeDefined();
  });

  it("enforces world minimums for an empty graph", () => {
    const layout = layoutWorkflow([], [], {});
    expect(layout.worldWidth).toBe(MIN_WORLD_WIDTH);
    expect(layout.worldHeight).toBe(MIN_WORLD_HEIGHT);
  });
});

describe("toWorkflowSceneEdges", () => {
  it("tags an unconditioned edge as a sequence with no label", () => {
    const [scene] = toWorkflowSceneEdges([edge("A", "B")]);
    expect(scene).toMatchObject({ kind: "sequence", from: "A", to: "B" });
    expect(scene.label).toBeUndefined();
  });

  it("tags a conditioned edge as a branch carrying the condition as label", () => {
    const [scene] = toWorkflowSceneEdges([edge("A", "B", "user approved")]);
    expect(scene.kind).toBe("branch");
    expect(scene.label).toBe("user approved");
  });

  it("is deterministic and 1:1 with input edges", () => {
    const edges = [edge("A", "B"), edge("B", "C", "retry")];
    expect(toWorkflowSceneEdges(edges)).toEqual(toWorkflowSceneEdges(edges));
    expect(toWorkflowSceneEdges(edges)).toHaveLength(2);
  });
});
