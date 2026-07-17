/**
 * Unit tests for the step-graph authoring ops. The step/edge repository,
 * ref resolution (authoring-refs), attachment validation, and reconcile are
 * mocked; the real cycle detection + header-sentinel guard run. Covers:
 *   - set_graph diff by ref (create / update / delete), cycle + header +
 *     duplicate-ref rejection, and branch-conditioned edge writes
 *   - connect with a condition, cycle rejection, header rejection
 *   - add_node entry detection (indegree 0 with no connect_from)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkflowStep, WorkflowEdge } from "../types";
import type { WorkflowScope } from "./service";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("./attachments", () => ({ validateKbsForWorkflow: vi.fn() }));
vi.mock("./authoring-refs", () => ({
  nodeDataFrom: vi.fn(async (input: Record<string, unknown>) => ({
    title: (input.title as string) ?? "",
    data: {
      description: (input.description as string) ?? "",
      reads: [],
      actions: [],
      userInput: (input.userInput as string) ?? "",
      agentOutput: (input.agentOutput as string) ?? "",
      nextInstructions: (input.nextInstructions as string) ?? "",
      ref: input.ref as string,
    },
  })),
  kbIdsOf: vi.fn(() => []),
}));
vi.mock("./authoring-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./authoring-shared")>();
  return { ...actual, reconcileAttachments: vi.fn() };
});
vi.mock("./repository", () => ({
  listSteps: vi.fn(),
  listEdges: vi.fn(),
  insertStep: vi.fn(),
  updateStep: vi.fn(),
  deleteStep: vi.fn(),
  insertEdge: vi.fn(),
  deleteEdge: vi.fn(),
  findStep: vi.fn(),
  getStep: vi.fn(),
  countSteps: vi.fn(),
}));

import * as repo from "./repository";
import { setGraph } from "./authoring-graph";
import { connect } from "./authoring-edges";
import { addNode } from "./authoring-nodes";

const scope: WorkflowScope = {
  workspaceId: "ws",
  userId: "u",
  role: "member",
  source: "agent",
};
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.insertStep).mockImplementation(async (_db, _ws, _wf, w) => `id-${w.ref}`);
  vi.mocked(repo.listEdges).mockResolvedValue([]);
});

describe("setGraph — declarative diff by ref", () => {
  it("creates new steps, updates matching refs, deletes dropped ones", async () => {
    vi.mocked(repo.listSteps).mockResolvedValue([step("id-keep", "keep"), step("id-drop", "drop")]);

    await setGraph(
      WF,
      { nodes: [{ ref: "keep", title: "Keep" }, { ref: "new", title: "New" }], edges: [] },
      scope
    );

    // "keep" exists -> update by its id; "new" is inserted; "drop" is deleted.
    expect(vi.mocked(repo.updateStep)).toHaveBeenCalledWith(
      expect.anything(), "ws", WF, "id-keep", expect.objectContaining({ ref: "keep" })
    );
    expect(vi.mocked(repo.insertStep)).toHaveBeenCalledWith(
      expect.anything(), "ws", WF, expect.objectContaining({ ref: "new", position: 1 })
    );
    expect(vi.mocked(repo.deleteStep)).toHaveBeenCalledWith(
      expect.anything(), "ws", WF, "id-drop"
    );
  });

  it("writes edges resolved to step ids with their branch condition", async () => {
    vi.mocked(repo.listSteps).mockResolvedValue([]);

    await setGraph(
      WF,
      {
        nodes: [{ ref: "a" }, { ref: "b" }],
        edges: [{ from: "a", to: "b", condition: "user approved" }],
      },
      scope
    );

    expect(vi.mocked(repo.insertEdge)).toHaveBeenCalledWith(
      expect.anything(), "ws", WF, "id-a", "id-b", "user approved"
    );
  });

  it("rejects a cycle before any write", async () => {
    vi.mocked(repo.listSteps).mockResolvedValue([]);
    await expect(
      setGraph(
        WF,
        {
          nodes: [{ ref: "a" }, { ref: "b" }],
          edges: [
            { from: "a", to: "b" },
            { from: "b", to: "a" },
          ],
        },
        scope
      )
    ).rejects.toMatchObject({ code: "WORKFLOW_CYCLE" });
    expect(vi.mocked(repo.insertStep)).not.toHaveBeenCalled();
  });

  it('rejects the retired "header" sentinel in edges', async () => {
    await expect(
      setGraph(WF, { nodes: [{ ref: "a" }], edges: [{ from: "header", to: "a" }] }, scope)
    ).rejects.toMatchObject({ code: "HEADER_SENTINEL_REMOVED" });
  });

  it("rejects duplicate refs", async () => {
    await expect(
      setGraph(WF, { nodes: [{ ref: "x" }, { ref: "x" }], edges: [] }, scope)
    ).rejects.toMatchObject({ code: "DUPLICATE_REF" });
  });

  it("rejects a self-edge naming the offender", async () => {
    await expect(
      setGraph(WF, { nodes: [{ ref: "a" }], edges: [{ from: "a", to: "a" }] }, scope)
    ).rejects.toMatchObject({ code: "INVALID_EDGE" });
    expect(vi.mocked(repo.insertStep)).not.toHaveBeenCalled();
  });

  it("rejects an edge to an unknown ref", async () => {
    await expect(
      setGraph(WF, { nodes: [{ ref: "a" }], edges: [{ from: "a", to: "ghost" }] }, scope)
    ).rejects.toMatchObject({ code: "INVALID_EDGE" });
    expect(vi.mocked(repo.insertStep)).not.toHaveBeenCalled();
  });

  it("rejects a duplicate edge pair with conflicting conditions", async () => {
    await expect(
      setGraph(
        WF,
        {
          nodes: [{ ref: "a" }, { ref: "b" }],
          edges: [
            { from: "a", to: "b", condition: "approved" },
            { from: "a", to: "b", condition: "rejected" },
          ],
        },
        scope
      )
    ).rejects.toMatchObject({ code: "DUPLICATE_EDGE" });
    expect(vi.mocked(repo.insertStep)).not.toHaveBeenCalled();
  });

  it("dedups an identical duplicate edge pair silently", async () => {
    vi.mocked(repo.listSteps).mockResolvedValue([]);

    await setGraph(
      WF,
      {
        nodes: [{ ref: "a" }, { ref: "b" }],
        edges: [
          { from: "a", to: "b", condition: "approved" },
          { from: "a", to: "b", condition: "approved" },
        ],
      },
      scope
    );

    expect(vi.mocked(repo.insertEdge)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.insertEdge)).toHaveBeenCalledWith(
      expect.anything(), "ws", WF, "id-a", "id-b", "approved"
    );
  });
});

describe("connect", () => {
  beforeEach(() => {
    vi.mocked(repo.findStep).mockImplementation(async (_db, _ws, _wf, token) => ({
      id: `id-${token}`,
      ref: token,
    }));
  });

  it("inserts an edge with the branch condition", async () => {
    await connect(WF, "a", "b", "approved", scope);
    expect(vi.mocked(repo.insertEdge)).toHaveBeenCalledWith(
      expect.anything(), "ws", WF, "id-a", "id-b", "approved"
    );
  });

  it("rejects a back-edge that would close a cycle", async () => {
    // b already reaches a (edge b→a exists), so a→b closes a cycle.
    const existing: WorkflowEdge = { id: "e", fromStepId: "id-b", toStepId: "id-a", condition: "" };
    vi.mocked(repo.listEdges).mockResolvedValue([existing]);
    await expect(connect(WF, "a", "b", "", scope)).rejects.toMatchObject({
      code: "WORKFLOW_CYCLE",
    });
    expect(vi.mocked(repo.insertEdge)).not.toHaveBeenCalled();
  });

  it('rejects the "header" sentinel', async () => {
    await expect(connect(WF, "header", "b", "", scope)).rejects.toMatchObject({
      code: "HEADER_SENTINEL_REMOVED",
    });
  });
});

describe("addNode — entry detection", () => {
  it("adds an entry step (no incoming edge) when connect_from is omitted", async () => {
    vi.mocked(repo.findStep).mockResolvedValue(null); // no ref collision
    vi.mocked(repo.countSteps).mockResolvedValue(0);

    const id = await addNode(WF, { ref: "s1", title: "Start" }, undefined, scope);

    expect(id).toBe("id-s1");
    expect(vi.mocked(repo.insertStep)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.insertEdge)).not.toHaveBeenCalled();
  });

  it("wires an edge in from connect_from when provided", async () => {
    vi.mocked(repo.findStep).mockImplementation(async (_db, _ws, _wf, token) =>
      token === "s2" ? null : { id: `id-${token}`, ref: token }
    );
    vi.mocked(repo.countSteps).mockResolvedValue(1);

    await addNode(WF, { ref: "s2", title: "Next" }, "s1", scope);

    expect(vi.mocked(repo.insertEdge)).toHaveBeenCalledWith(
      expect.anything(), "ws", WF, "id-s1", "id-s2", ""
    );
  });
});
