/**
 * Unit tests for workflow graph composition. The step/edge repository is
 * mocked (no Supabase); we assert the topological ordering, branch-edge
 * passthrough, entry (indegree-0) ordering, and cycle fallback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkflowStep, WorkflowEdge } from "../types";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("./repository", () => ({
  listSteps: vi.fn(),
  listEdges: vi.fn(),
}));

import * as repo from "./repository";
import { composeWorkflow, topoSort } from "./graph";

const WS = "ws-1";
const WF = "wf-1";

function step(id: string, ref = id): WorkflowStep {
  return {
    id,
    ref,
    title: ref,
    description: "",
    reads: [],
    actions: [],
    userInput: "",
    agentOutput: "",
    nextInstructions: "",
  };
}

function edge(from: string, to: string, condition = ""): WorkflowEdge {
  return { id: `${from}-${to}`, fromStepId: from, toStepId: to, condition };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("composeWorkflow", () => {
  it("returns an empty graph for a workflow with no steps", async () => {
    vi.mocked(repo.listSteps).mockResolvedValue([]);
    vi.mocked(repo.listEdges).mockResolvedValue([]);
    const g = await composeWorkflow(WS, WF);
    expect(g).toEqual({ nodes: [], edges: [] });
  });

  it("topologically orders steps and carries branch conditions on edges", async () => {
    // A → B (when c1), A → C. B and C both depend on A.
    vi.mocked(repo.listSteps).mockResolvedValue([step("A"), step("B"), step("C")]);
    vi.mocked(repo.listEdges).mockResolvedValue([
      edge("A", "B", "user approved"),
      edge("A", "C"),
    ]);

    const g = await composeWorkflow(WS, WF);

    expect(g.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(g.edges).toEqual([
      { from: "A", to: "B", condition: "user approved" },
      { from: "A", to: "C", condition: "" },
    ]);
  });

  it("orders an entry (indegree-0) step first even when its position is later", async () => {
    // Y is authored second (position order [X, Y]) but X depends on Y, so
    // Y is the entry and must sort ahead of X.
    vi.mocked(repo.listSteps).mockResolvedValue([step("X"), step("Y")]);
    vi.mocked(repo.listEdges).mockResolvedValue([edge("Y", "X")]);

    const g = await composeWorkflow(WS, WF);
    expect(g.nodes.map((n) => n.id)).toEqual(["Y", "X"]);
  });

  it("falls back to position order when the graph has a cycle", async () => {
    vi.mocked(repo.listSteps).mockResolvedValue([step("A"), step("B")]);
    vi.mocked(repo.listEdges).mockResolvedValue([edge("A", "B"), edge("B", "A")]);

    const g = await composeWorkflow(WS, WF);
    expect(g.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    expect(g.edges).toHaveLength(2);
  });
});

describe("topoSort", () => {
  it("keeps a linear chain in dependency order", () => {
    const sorted = topoSort(
      [step("C"), step("A"), step("B")],
      [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ]
    );
    expect(sorted.map((n) => n.id)).toEqual(["A", "B", "C"]);
  });
});
