/**
 * THE TWO PROMISES THIS PHASE MAKES TO AN AGENT, checked through the real
 * `createServer` rather than through the registrars.
 *
 *   1. D1/D2 — the retired tool NAMES are NOT IN `tools/list` and not in the
 *      instructions. They were hidden by `HIDDEN_TOOLS` on 2026-08-07 and
 *      DELETED on 2026-08-11, so what this now guards is REGROWTH, not a gate:
 *      the names must not come back as tools and must not come back as routing
 *      prose. Registering against a mocked `McpServer` and asserting on what
 *      actually landed there is what makes that observable — `parity.test.ts`
 *      calls each registrar directly, which is the right level for schema
 *      parity and cannot see the server's published surface at all.
 *
 *   2. §2b — a delete op REFUSES, and refuses BEFORE it does anything. The
 *      refusal is worth pinning as behavior and not just as a table because the
 *      table cannot say *when* the check runs: the guarantee is that no
 *      workspace is resolved and no backend request is made, so a refused
 *      delete cannot half-happen.
 *
 * The SDK mock is the same shape `server.test.ts` uses (`registerTool` only, so
 * a regression to the positional `tool()` overload is a TypeError naming the
 * method) — duplicated rather than shared because sharing it would mean
 * exporting a mock from a test file and hoisting across module boundaries.
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
    constructor(_info: unknown, opts: { instructions?: string }) {
      registry.instructions = opts?.instructions ?? "";
    }
    registerTool(name: string, _config: unknown, handler: Handler) {
      registry.tools.set(name, handler);
    }
  },
}));

import { createServer, buildInstructions } from "./server.js";
// The policy itself, from the module that owns both halves of it — the refusal
// the server returns and the description the `_admin` tools advertise.
import { isBlockedDeleteOp, DELETE_REFUSAL } from "./delete-policy.js";

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
    workspaceSource: "sole membership",
    ...over,
  });
  return client;
}

function tool(name: string): Handler {
  const h = registry.tools.get(name);
  if (!h) throw new Error(`${name} was not registered`);
  return h;
}

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("");

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. The retired tools do not exist ────────────────────────────────

/**
 * Names that were published, then hidden (2026-08-07), then deleted with
 * their registrars, routes and tables (2026-08-11). Nothing in the tree can
 * register one today — which is exactly why the list is worth keeping: it is
 * the regrowth guard, and it costs four strings.
 */
const RETIRED = [
  "dopl_workflow",
  "dopl_workflow_admin",
  "dopl_cluster",
  "dopl_cluster_admin",
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
      "dopl_kb_admin",
      "dopl_skill",
      "dopl_skill_admin",
      "dopl_chats",
      "dopl_chats_admin",
      "dopl_ontology",
      "dopl_ontology_admin",
      "dopl_members",
      "dopl_map",
      "dopl_search",
      "dopl_channel",
      "list_workspaces",
      "current_workspace",
    ]) {
      expect(registry.tools.has(name), `${name} is missing from the registry`).toBe(true);
    }
  });

  it("the instructions every agent reads name none of them", () => {
    // The instructions are read ONCE, ahead of the first tool call, so a
    // routing line pointing at a tool that is not in `tools/list` is the
    // costliest stale sentence on the whole surface.
    const text = buildInstructions([WS]);
    for (const name of RETIRED) {
      expect(text.includes(name), `buildInstructions still routes to ${name}`).toBe(false);
    }
    expect(text.toLowerCase()).not.toContain("canvas");
  });

  it("the instructions still tell the agent what the product IS", () => {
    // The negative assertions above pass on an empty string, so pin the story.
    const text = buildInstructions([WS]);
    for (const noun of ["dopl_kb", "dopl_skill", "dopl_ontology", "dopl_chats", "dopl_channel", "dopl_members"]) {
      expect(text).toContain(noun);
    }
  });
});

// ── 2. Deletion is app-only (§2b) ────────────────────────────────────

/** Every delete-shaped op on every admin tool that still registers. */
const DELETE_CALLS: Array<[string, Record<string, unknown>]> = [
  ["dopl_kb_admin", { op: "delete_base", base: "notes" }],
  ["dopl_kb_admin", { op: "delete_folder", base: "notes", path: "a" }],
  ["dopl_kb_admin", { op: "delete_file", base: "notes", path: "a/b" }],
  ["dopl_skill_admin", { op: "delete", slug: "ship-it" }],
  ["dopl_chats_admin", { op: "delete", chat_id: "c-1" }],
  ["dopl_chats_admin", { op: "delete_folder", folder_id: "f-1" }],
  ["dopl_ontology_admin", { op: "delete_object", object: "o-1" }],
  ["dopl_ontology_admin", { op: "delete_cluster", cluster: "board" }],
];

describe("every delete op is refused (§2b)", () => {
  for (const [name, args] of DELETE_CALLS) {
    it(`${name} op="${args.op}" returns the refusal and deletes nothing`, async () => {
      const client = build();
      const res = await tool(name)(args);
      expect(res.isError).toBe(true);
      expect(textOf(res)).toBe(DELETE_REFUSAL);
      // The client is all-tripwires: any handler that ran would have thrown,
      // so a passing assertion here is proof the op never reached the backend.
      expect(client.listWorkspaces).not.toHaveBeenCalled();
    });
  }

  it("the refusal says the required sentence, verbatim", () => {
    // Copy an agent (and a user reading the transcript) acts on. Pinned so a
    // reword cannot quietly turn "ask the user" into an unactionable "denied".
    expect(DELETE_REFUSAL).toContain(
      "Deletion is app-only. Ask the user to delete this in the Dopl app.",
    );
    // And it must close the retry loop, or the agent walks the op enum.
    expect(DELETE_REFUSAL).toContain("do not retry");
  });

  it("refuses BEFORE workspace resolution — a 2+-membership session gets the same answer", async () => {
    // The ordering guarantee. If the delete check sat after the workspace
    // gate, this call would come back "which workspace?" — an error an agent
    // fixes by adding `workspace=` and calling the delete again.
    build({ directory: [WS, { ...WS, id: "id-2", slug: "beta", name: "Beta" }], workspace: null, role: null, workspaceSource: null });
    const res = await tool("dopl_kb_admin")({ op: "delete_base", base: "notes" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe(DELETE_REFUSAL);
  });

  it("does not touch the non-destructive ops on the same tools", async () => {
    // `restore_*` reads as recovery, not deletion, and must not be swept up.
    const client = build();
    await expect(tool("dopl_kb")({ op: "list_bases" })).rejects.toThrow(
      "client.listKbBases() was called",
    );
    expect(client.listWorkspaces).not.toHaveBeenCalled();
  });
});

describe("isBlockedDeleteOp — the rule future tools inherit", () => {
  it("blocks the enumerated ops", () => {
    expect(isBlockedDeleteOp("dopl_kb_admin", "delete_base")).toBe(true);
    expect(isBlockedDeleteOp("dopl_skill_admin", "delete")).toBe(true);
    expect(isBlockedDeleteOp("dopl_ontology_admin", "delete_cluster")).toBe(true);
  });

  it("FAILS CLOSED on an admin op nobody added to the table", () => {
    // The point of the second mechanism: a tool shipped tomorrow with
    // op="delete_everything" is refused without anyone remembering this file.
    expect(isBlockedDeleteOp("dopl_future_admin", "delete_everything")).toBe(true);
    expect(isBlockedDeleteOp("dopl_future_admin", "purge")).toBe(true);
    expect(isBlockedDeleteOp("dopl_future_admin", "trash_entry")).toBe(true);
  });

  it("does not block edits that merely READ as removals", () => {
    // `remove_attribute` strips a field FROM an object; the object survives.
    // It lives on the non-admin `dopl_ontology`, and the name-shape fallback
    // is scoped to `_admin` precisely so this keeps working.
    expect(isBlockedDeleteOp("dopl_ontology", "remove_attribute")).toBe(false);
    expect(isBlockedDeleteOp("dopl_ontology", "remove_relationship")).toBe(false);
    expect(isBlockedDeleteOp("dopl_kb", "restore_base")).toBe(false);
    expect(isBlockedDeleteOp("dopl_kb", "write_file")).toBe(false);
  });
});
