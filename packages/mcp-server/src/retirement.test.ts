/**
 * TWO PROMISES, checked through the real `createServer` rather than through the
 * registrars (which cannot see the published surface at all):
 *
 *   1. Retired tool NAMES are absent from `tools/list` AND from the
 *      instructions. ⚠ This guards REGROWTH, not a gate — the names must not
 *      come back as tools or as routing prose.
 *   2. A delete op REFUSES, and refuses BEFORE it does anything. ⚠ Pinned as
 *      BEHAVIOUR because a table cannot say WHEN the check runs: no workspace
 *      resolved, no backend request, so a refused delete cannot half-happen.
 *
 * ⚠ SDK mock exposes `registerTool` only, so a regression to the positional
 * `tool()` overload is a TypeError naming the method.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

const registry = vi.hoisted(() => ({
  tools: new Map<string, Handler>(),
  instructions: "",
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    // ⚠ THE MCP RESOURCE SEAM (2026-09-02). `createServer` publishes
    // `dopl://doctrine/channels` through `registerResource` (`resources.ts`), so
    // a double without this method throws before a single tool is registered.
    // ⚠ IT IS A NO-OP HERE ON PURPOSE — these suites assert over TOOLS. The
    // resource's own content is pinned in `channel-doctrine.test.ts`, and that
    // it is registered at all in `server.test.ts`.
    registerResource() {}
    constructor(_info: unknown, opts: { instructions?: string }) {
      registry.instructions = opts?.instructions ?? "";
    }
    registerTool(name: string, _config: unknown, handler: Handler) {
      registry.tools.set(name, handler);
    }
  },
}));

import { createServer, buildInstructions } from "./server.js";
// The policy from the module that owns it: the refusal, and the table of delete
// ops no tool may publish.
import {
  DELETE_BLOCKED_OPS,
  DELETE_REFUSAL,
  isBlockedDeleteOp,
} from "./delete-policy.js";

const WS: WorkspaceListItem = {
  id: "id-1",
  ownerId: "owner",
  name: "Alpha",
  slug: "alpha",
  publicId: "pub-1",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  role: "owner",
};

/** Every client method the registrars might touch, all of them tripwires. */
function mockClient(): DoplClient {
  const unexpected = (name: string) => vi.fn(async () => {
    throw new Error(`the handler ran: client.${name}() was called`);
  });
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [WS] }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    listKbBases: unexpected("listKbBases"),
    listKbBasesPayload: unexpected("listKbBasesPayload"),
    listSkills: unexpected("listSkills"),
    getOntology: unexpected("getOntology"),
    deleteKbBase: unexpected("deleteKbBase"),
    deleteSkill: unexpected("deleteSkill"),
    deleteChat: unexpected("deleteChat"),
    deleteChatFolder: unexpected("deleteChatFolder"),
    deleteOntologyObject: unexpected("deleteOntologyObject"),
    deleteOntologyCluster: unexpected("deleteOntologyCluster"),
  } as unknown as DoplClient;
}

/** A fully-resolved write-capable session — the most permissive one possible. */
function build(over: Partial<Parameters<typeof createServer>[1]> = {}) {
  registry.tools.clear();
  const client = mockClient();
  createServer(client, {
    scopes: ["dopl.read", "dopl.write"],
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "header pin",
    ...over,
  });
  return client;
}

function tool(name: string): Handler {
  const h = registry.tools.get(name);
  if (!h) throw new Error(`${name} was not registered`);
  return h;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. The retired tools do not exist ────────────────────────────────

/**
 * Names that were published, then hidden, then deleted with their registrars,
 * routes and tables. ⚠ Kept as the REGROWTH guard — nothing in the tree can
 * register one today, and that is the point.
 */
const RETIRED = [
  "dopl_workflow",
  "dopl_workflow_admin",
  "dopl_cluster",
  "dopl_cluster_admin",
  // ⚠ THE FIVE `_admin` COMPANIONS (2026-09-02). Every op on all five was
  // refused unconditionally, they were 9,295 served chars, and the sentence
  // they existed to publish is now enforced in code: `sessionOnly: true` on all
  // ten app-only `DELETE` routes. Same hide-then-delete path the four above
  // took, and they are on this list for the same reason — regrowth.
  "dopl_kb_admin",
  "dopl_skill_admin",
  "dopl_chats_admin",
  "dopl_ontology_admin",
  "dopl_agent_admin",
  // ⚠ **THE THREE B13 RETIRED (2026-09-02), AND THEY ARE ONE DECISION.**
  // `current_workspace` and `list_workspaces` answered "where am I" and "what
  // can I reach"; `dopl_home` existed because a container was hidden from the
  // second. B10 removes the default workspace, so nothing is silently picked,
  // so a container is just a container — one tool, `dopl_workspaces`, answers
  // all three. ⚠ `dopl_home(op="create_channel")` is NOT re-homed: minting a
  // room is an app act, exactly as its invite half already was.
  "current_workspace",
  "list_workspaces",
  "dopl_home",
];

describe("retired tools never register (D1/D2)", () => {
  it("none of them is in the registry an owner-scoped session builds", () => {
    build();
    for (const name of RETIRED) {
      expect(
        registry.tools.has(name),
        `${name} registered — it would appear in tools/list and be callable`,
      ).toBe(false);
    }
  });

  it("removing them did not take the surviving tools with them", () => {
    build();
    for (const name of [
      "dopl_kb",
      "dopl_skill",
      "dopl_chats",
      "dopl_ontology",
      "dopl_members",
      "dopl_map",
      "dopl_search",
      "dopl_channel",
      "dopl_agent",
      // ⚠ THE SECOND CHARGED META TOOL (2026-09-01, T20). It is on this list for
      // the same reason every other name is: a tool that stops registering is
      // invisible to `tools/list` and to every agent, and nothing else in this
      // suite would notice.
      "dopl_status",
      "dopl_workspaces",
    ]) {
      expect(registry.tools.has(name), `${name} is missing from the registry`).toBe(true);
    }
  });

  it("the instructions every agent reads name none of them", () => {
    // ⚠ The instructions are read ONCE ahead of the first tool call, so a
    // routing line naming a tool absent from `tools/list` is the costliest
    // stale sentence on the surface.
    const text = buildInstructions([WS]);
    for (const name of RETIRED) {
      expect(text.includes(name), `buildInstructions still routes to ${name}`).toBe(false);
    }
    expect(text.toLowerCase()).not.toContain("canvas");
  });

  it("the instructions still tell the agent what the product IS", () => {
    // ⚠ The negative assertions above pass on an empty string.
    const text = buildInstructions([WS]);
    for (const noun of ["dopl_kb", "dopl_skill", "dopl_ontology", "dopl_chats", "dopl_channel", "dopl_members"]) {
      expect(text).toContain(noun);
    }
  });
});

// ── 2. Deletion is app-only ──────────────────────────────────────────

/**
 * ⚠ THE OPS THAT NO LONGER EXIST, DRIVEN THROUGH THE REAL SERVER. Each was a
 * published `_admin` op until 2026-09-02. The tool is gone, so the strongest
 * behavioural claim left is that the call is not answerable at all — and the
 * `[tool, op]` pairs are kept, rather than replaced by a name list, so a
 * reintroduction under any spelling shows up here.
 */
const DELETED_DELETE_CALLS: Array<[string, string]> = [
  ["dopl_kb_admin", "delete_base"],
  ["dopl_kb_admin", "delete_folder"],
  ["dopl_kb_admin", "delete_file"],
  ["dopl_skill_admin", "delete"],
  ["dopl_chats_admin", "delete"],
  ["dopl_chats_admin", "delete_folder"],
  ["dopl_ontology_admin", "delete_object"],
  ["dopl_ontology_admin", "delete_cluster"],
  ["dopl_agent_admin", "delete"],
];

describe("no delete op is reachable over MCP", () => {
  it("none of the deleted `_admin` tools registers, so no delete op has a handler", () => {
    build();
    for (const [name] of DELETED_DELETE_CALLS) {
      expect(
        registry.tools.has(name),
        `${name} registered — it would appear in tools/list and its delete op would be callable`,
      ).toBe(false);
    }
  });

  it("the gate would refuse one on the DOMAIN tool it could only arrive on", () => {
    // ⚠ The half that matters after the deletion: the capability must not
    // reappear on a domain tool. `tools/delete-block.test.ts` asserts none of
    // these ops is in a live `op` enum; this asserts the second layer — that if
    // one were, the gate refuses it before workspace resolution and before any
    // client call, so it could not half-happen.
    for (const [tool, ops] of Object.entries(DELETE_BLOCKED_OPS)) {
      for (const op of ops) {
        expect(isBlockedDeleteOp(tool, op), `${tool} op="${op}" is not refused`).toBe(true);
      }
    }
  });

  it("the refusal says the required sentence, verbatim", () => {
    // ⚠ Pinned so a reword cannot turn "ask the user" into an unactionable
    // "denied". It is the answer the gate returns the moment a delete-shaped op
    // lands on a tool, and the wording the `sessionOnly` 403 backs up.
    expect(DELETE_REFUSAL).toContain(
      "Deletion is app-only. Ask the user to delete this in the Dopl app.",
    );
    // ⚠ Must close the retry loop, or the agent walks the op enum.
    expect(DELETE_REFUSAL).toContain("do not retry");
  });

  it("does not touch the non-destructive ops on the surviving tools", async () => {
    // ⚠ `restore_*` reads as recovery, not deletion — must not be swept up.
    const client = build();
    await expect(tool("dopl_kb")({ op: "list_bases" })).rejects.toThrow(
      "client.listKbBasesPayload() was called",
    );
    expect(client.listWorkspaces).not.toHaveBeenCalled();
  });
});

describe("isBlockedDeleteOp — the rule future tools inherit", () => {
  it("blocks the enumerated ops on the DOMAIN tools that would publish them", () => {
    // ⚠ Re-keyed 2026-09-02: the table used to name `dopl_kb_admin`; with the
    // `_admin` tools gone it names the tool a delete op could only arrive on.
    expect(isBlockedDeleteOp("dopl_kb", "delete_base")).toBe(true);
    expect(isBlockedDeleteOp("dopl_skill", "delete")).toBe(true);
    expect(isBlockedDeleteOp("dopl_ontology", "delete_cluster")).toBe(true);
  });

  it("FAILS CLOSED on an admin op nobody added to the table", () => {
    // ⚠ The second mechanism: a tool shipped tomorrow with
    // op="delete_everything" is refused without anyone remembering this file.
    expect(isBlockedDeleteOp("dopl_future_admin", "delete_everything")).toBe(true);
    expect(isBlockedDeleteOp("dopl_future_admin", "purge")).toBe(true);
    expect(isBlockedDeleteOp("dopl_future_admin", "trash_entry")).toBe(true);
  });

  it("does not block edits that merely READ as removals", () => {
    // ⚠ `remove_attribute` strips a field FROM an object and the object
    // survives — it lives on the non-admin `dopl_ontology`, and the name-shape
    // fallback is scoped to `_admin` precisely so this keeps working.
    expect(isBlockedDeleteOp("dopl_ontology", "remove_attribute")).toBe(false);
    expect(isBlockedDeleteOp("dopl_ontology", "remove_relationship")).toBe(false);
    expect(isBlockedDeleteOp("dopl_kb", "restore_base")).toBe(false);
    expect(isBlockedDeleteOp("dopl_kb", "write_file")).toBe(false);
  });
});
