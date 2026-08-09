/**
 * THE GUARD ON THE §2 PER-DOMAIN SPLIT.
 *
 * `client.ts` was one 720-line class; it is now a terminal link on a chain of
 * `client-<domain>.ts` method groups (see `client-base.ts`). That refactor is
 * only correct if NOTHING about `DoplClient` changed for a caller — and the
 * package's other three test files never touched most of the surface, so a
 * method silently lost in the move, or a route that drifted when its body left
 * the class, would have gone green.
 *
 * Two checks, for the two ways the split could lie:
 *
 *  1. THE SURFACE. `PUBLIC_SURFACE` is the frozen method list — the exact
 *     public API that `@dopl/mcp-server` and the app compile against. (Read
 *     off the declaration emit, minus the trash-teardown methods that left the
 *     class in a separate change; see the note on the constant itself, which
 *     is where the seven-method gap against HEAD is accounted for.) Checked in
 *     BOTH directions: every frozen name still resolves to a function on an
 *     instance, and the prototype chain exposes nothing that is not on the
 *     list. Adding a method to a link means adding it here, deliberately.
 *
 *  2. THE ROUTES THAT MOVED. Only the cluster / workflow / workspace bodies
 *     actually relocated (into `clusters.ts`, `workflows.ts`, `workspaces.ts`);
 *     every other domain already delegated to a module this refactor never
 *     touched. Those are the ones whose path, verb, and tool header are pinned
 *     here — including the `encodeURIComponent` on every interpolated segment,
 *     which is the detail a move is most likely to drop.
 */

import { afterEach, describe, expect, it } from "vitest";

import { DoplClient } from "./client.js";

const BASE = "https://api.example.test";

/**
 * Every public method of `DoplClient`, extracted mechanically from a `.d.ts`
 * rather than typed by hand.
 *
 * PROVENANCE, stated exactly, because "the pre-split surface" is what this
 * used to say and it is off by seven. HEAD's `client.d.ts` declared 92 methods
 * (93 members, less the constructor). This list has 85. The difference is NOT
 * the split — which moved declarations between files and dropped none — but
 * the trash teardown that landed in the same working tree and removed
 * `listChatsTrash`, `listKbTrash`, `restoreChat`, `restoreKbBase`,
 * `restoreKbEntry`, `restoreKbFolder` and `restoreOntologyCluster` from the
 * class outright. So this is the POST-TEARDOWN surface, and the split's
 * guarantee is that it did not change it further.
 *
 * That distinction is the whole value of the check below: read as "the
 * pre-split list", a diff of seven would look like the split silently eating
 * methods. It is two changes in one diff, and only one of them is a move.
 */
const PUBLIC_SURFACE = [
  "addWorkflowNode",
  "appendChatMessages",
  "awaitChannelMessages",
  "claimOntologyAnchor",
  "closeChannelThread",
  "connectWorkflow",
  "createChannel",
  "createChannelThread",
  "createChatFolder",
  "createCluster",
  "createKbBase",
  "createKbFolderByPath",
  "createOntologyCluster",
  "createOntologyObject",
  "createSkill",
  "createWorkflow",
  "deleteChat",
  "deleteChatFolder",
  "deleteCluster",
  "deleteKbBase",
  "deleteKbByPath",
  "deleteOntologyCluster",
  "deleteOntologyObject",
  "deleteSkill",
  "deleteWorkflow",
  "disconnectWorkflow",
  "exportChat",
  "getAccessMatrix",
  "getActiveWorkspace",
  "getBaseUrl",
  "getChannel",
  "getChannelThread",
  "getChat",
  "getCluster",
  "getKbBase",
  "getKbTree",
  "getMemberAccess",
  "getMyAccess",
  "getMyMembership",
  "getOntology",
  "getOntologyAnchor",
  "getSkill",
  "getWorkflow",
  "getWorkspace",
  "getWorkspaceId",
  "inviteToChannel",
  "listChannelMembers",
  "listChannelSessions",
  "listChannelThreads",
  "listChannels",
  "listChatFolders",
  "listChats",
  "listClusters",
  "listKbBases",
  "listKbDirByPath",
  "listSkills",
  "listWorkflowTrash",
  "listWorkflows",
  "listWorkspaceMembers",
  "listWorkspaceTeams",
  "listWorkspaces",
  "moveKbByPath",
  "pingMcpStatus",
  "postChannelMessage",
  "proposeChannelThreadClose",
  "readChannelMessages",
  "readKbFileByPath",
  "readSkillBody",
  "removeWorkflowNode",
  "restoreWorkflow",
  "searchKb",
  "setChannelThreadMode",
  "setWorkflowGraph",
  "setWorkspaceId",
  "updateChat",
  "updateChatFolder",
  "updateCluster",
  "updateKbBase",
  "updateOntologyCluster",
  "updateOntologyObject",
  "updateSkill",
  "updateWorkflow",
  "updateWorkflowNode",
  "writeKbFileByPath",
  "writeSkillBody",
] as const;

/** Every method name reachable on an instance, across the whole chain. */
function prototypeChainMethods(instance: object): string[] {
  const names = new Set<string>();
  let proto: object | null = Object.getPrototypeOf(instance);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      names.add(name);
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...names].sort();
}

describe("DoplClient public surface (frozen across the §2 split)", () => {
  const client = new DoplClient(BASE, "k");

  it("still exposes every method the pre-split class declared", () => {
    const missing = PUBLIC_SURFACE.filter(
      (name) => typeof (client as unknown as Record<string, unknown>)[name] !== "function"
    );
    expect(missing).toEqual([]);
  });

  it("exposes NOTHING beyond that list (the chain adds no surface)", () => {
    expect(prototypeChainMethods(client)).toEqual([...PUBLIC_SURFACE].sort());
  });

  it("is a single flat class — no sub-client namespaces were introduced", () => {
    // The split had one tempting shortcut that would have broken every
    // caller: `client.workflows.list()` instead of `client.listWorkflows()`.
    for (const ns of ["workflows", "clusters", "workspaces", "kb", "channels", "skills"]) {
      expect((client as unknown as Record<string, unknown>)[ns]).toBeUndefined();
    }
  });

  it("keeps the constructor's three-argument shape", () => {
    const withOpts = new DoplClient(BASE, "k", { clientIdentifier: "x@1" });
    expect(withOpts.getBaseUrl()).toBe(BASE);
    expect(withOpts.getWorkspaceId()).toBeNull();
    withOpts.setWorkspaceId("ws-1");
    expect(withOpts.getWorkspaceId()).toBe("ws-1");
  });
});

interface Wire {
  path: string;
  method: string;
  tool: string | undefined;
}

/** Captures the single request a method makes, as path / verb / tool header. */
function captureWire(): { wires: Wire[]; restore: () => void } {
  const wires: Wire[] = [];
  const original = global.fetch;
  global.fetch = (async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    wires.push({
      path: String(input).replace(BASE, ""),
      method: init?.method ?? "GET",
      tool: headers["X-MCP-Tool"],
    });
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    wires,
    restore: () => {
      global.fetch = original;
    },
  };
}

describe("routes that MOVED out of client.ts", () => {
  let cap: ReturnType<typeof captureWire>;
  afterEach(() => cap?.restore());

  /** Runs one call and returns the single request it put on the wire. */
  async function wireOf(call: (c: DoplClient) => Promise<unknown>): Promise<Wire> {
    cap = captureWire();
    await call(new DoplClient(BASE, "k"));
    expect(cap.wires).toHaveLength(1);
    return cap.wires[0];
  }

  const cases: Array<[string, (c: DoplClient) => Promise<unknown>, Wire]> = [
    // ── clusters.ts ──────────────────────────────────────────────────
    ["createCluster", (c) => c.createCluster("n"), { path: "/api/clusters", method: "POST", tool: "canvas_create_cluster" }],
    ["listClusters", (c) => c.listClusters(), { path: "/api/clusters", method: "GET", tool: "list_clusters" }],
    ["getCluster", (c) => c.getCluster("a/b"), { path: "/api/clusters/a%2Fb", method: "GET", tool: "get_cluster" }],
    ["updateCluster", (c) => c.updateCluster("s", { name: "x" }), { path: "/api/clusters/s", method: "PATCH", tool: "update_cluster" }],
    ["deleteCluster", (c) => c.deleteCluster("s"), { path: "/api/clusters/s", method: "DELETE", tool: "delete_cluster" }],

    // ── workflows.ts ─────────────────────────────────────────────────
    ["listWorkflows", (c) => c.listWorkflows(), { path: "/api/workflows", method: "GET", tool: "list_workflows" }],
    ["getWorkflow", (c) => c.getWorkflow("a b"), { path: "/api/workflows/a%20b", method: "GET", tool: "get_workflow" }],
    ["createWorkflow", (c) => c.createWorkflow("n"), { path: "/api/workflows", method: "POST", tool: "create_workflow" }],
    ["updateWorkflow", (c) => c.updateWorkflow("w", { name: "x" }), { path: "/api/workflows/w", method: "PATCH", tool: "update_workflow" }],
    ["deleteWorkflow", (c) => c.deleteWorkflow("w"), { path: "/api/workflows/w", method: "DELETE", tool: "delete_workflow" }],
    // D3 — these two SURVIVED the trash teardown on purpose. Pinned so a
    // future "dead code" sweep has to argue with a failing test.
    ["listWorkflowTrash", (c) => c.listWorkflowTrash(), { path: "/api/workflows/trash", method: "GET", tool: "list_workflow_trash" }],
    ["restoreWorkflow", (c) => c.restoreWorkflow("w"), { path: "/api/workflows/w/restore", method: "POST", tool: "restore_workflow" }],
    ["setWorkflowGraph", (c) => c.setWorkflowGraph("w", { nodes: [], edges: [] }), { path: "/api/workflows/w/graph", method: "POST", tool: "set_workflow_graph" }],
    ["addWorkflowNode", (c) => c.addWorkflowNode("w", { ref: "r" }), { path: "/api/workflows/w/nodes", method: "POST", tool: "add_workflow_node" }],
    ["updateWorkflowNode", (c) => c.updateWorkflowNode("w", "n/1", {}), { path: "/api/workflows/w/nodes/n%2F1", method: "PATCH", tool: "update_workflow_node" }],
    ["removeWorkflowNode", (c) => c.removeWorkflowNode("w", "n"), { path: "/api/workflows/w/nodes/n", method: "DELETE", tool: "remove_workflow_node" }],
    ["connectWorkflow", (c) => c.connectWorkflow("w", "a", "b"), { path: "/api/workflows/w/edges", method: "POST", tool: "connect_workflow" }],
    ["disconnectWorkflow", (c) => c.disconnectWorkflow("w", "a", "b"), { path: "/api/workflows/w/edges", method: "DELETE", tool: "disconnect_workflow" }],

    // ── workspaces.ts ────────────────────────────────────────────────
    ["listWorkspaces", (c) => c.listWorkspaces(), { path: "/api/workspaces", method: "GET", tool: "list_workspaces" }],
    ["getWorkspace", (c) => c.getWorkspace("s p"), { path: "/api/workspaces/s%20p", method: "GET", tool: "get_workspace" }],
    ["getActiveWorkspace", (c) => c.getActiveWorkspace(), { path: "/api/workspaces/me", method: "GET", tool: "get_active_workspace" }],
    ["pingMcpStatus", (c) => c.pingMcpStatus(), { path: "/api/user/mcp-status", method: "POST", tool: "_mcp_status_ping" }],
  ];

  for (const [name, call, expected] of cases) {
    it(`${name} hits ${expected.method} ${expected.path}`, async () => {
      expect(await wireOf(call)).toEqual(expected);
    });
  }

  it("pingMcpStatus still normalises a missing envelope to false / null", async () => {
    cap = captureWire();
    const res = await new DoplClient(BASE, "k").pingMcpStatus();
    expect(res).toEqual({ is_admin: false, user_id: null });
  });
});
