/**
 * `WORKSPACE_ARG_OPS` — B2's ruling as a pinned table, and the one-release
 * IGNORE that makes retiring the argument safe (B13).
 *
 * ⚠ **THE POINT OF PINNING THE TABLE IS THE DIRECTION NOBODY WATCHES.** A row
 * naming an op that no longer exists silently stops honouring an argument, and
 * an op added with no classification silently inherits routing. Both fail here.
 *
 * ⚠ **AND THE IGNORE IS THE OTHER HALF.** `strictInput` refuses an unknown key,
 * so an argument dropped from the SCHEMA would turn "ignored" into `-32602` —
 * the one outcome B13 rules out. It stays published, is honoured on the ops in
 * the table, and is REPORTED on the footer everywhere else.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

const registry = vi.hoisted(() => ({
  tools: new Map<string, Handler>(),
  schemas: new Map<string, unknown>(),
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerResource() {}
    registerTool(
      name: string,
      config: { inputSchema?: unknown },
      handler: Handler,
    ) {
      registry.tools.set(name, handler);
      registry.schemas.set(name, config?.inputSchema);
    }
  },
}));

import { createServer } from "./server.js";
import { acceptsWorkspaceArg, WORKSPACE_ARG_OPS } from "./workspace-arg.js";

function wsItem(id: string, slug: string, name: string): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name,
    slug,
    publicId: `pub-${id}`,
    description: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "owner",
  };
}

const WS1 = wsItem("id-1", "alpha", "Alpha");
const WS2 = wsItem("id-2", "beta", "Beta");

/** ⚠ The complement of the domain set — neither carries an injected arg. */
const META_TOOLS = ["dopl_workspaces", "dopl_status"];

function mockClient(directory: WorkspaceListItem[]): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: directory }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ clusters: [], objects: {} }),
  } as unknown as DoplClient;
}

function build(bound: boolean) {
  registry.tools.clear();
  registry.schemas.clear();
  const client = mockClient([WS1, WS2]);
  createServer(client, {
    scopes: ["dopl.read", "dopl.write"],
    directory: [WS1, WS2],
    workspace: bound ? WS1 : null,
    role: bound ? "owner" : null,
    workspaceSource: bound ? "header pin" : null,
  });
  return { client };
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

// ── WHICH OPS STILL TAKE IT — B2's ruling, as a pinned table ────────────────
//
// ⚠ **THE POINT OF PINNING IT IS THE OTHER DIRECTION.** A row naming an op that
// no longer exists silently stops honouring an argument nobody notices; an op
// added with no classification silently inherits routing. Both fail here.

describe("`WORKSPACE_ARG_OPS` — the list/create set (B2/B13)", () => {
  /** The `op` enum a registered tool publishes, or null for a tool with none. */
  function opsOf(name: string): string[] | null {
    const shape = (registry.schemas.get(name) as { shape?: Record<string, unknown> })
      ?.shape;
    const op = shape?.op as { options?: unknown[]; def?: { entries?: object } } | undefined;
    if (!op) return null;
    const entries = (op as { def?: { entries?: Record<string, string> } }).def?.entries;
    return entries ? Object.values(entries) : null;
  }

  beforeEach(() => {
    build(true);
  });

  it("covers EVERY domain tool — a tool with no row honours the arg nowhere", () => {
    const domain = [...registry.schemas.keys()].filter((n) => !META_TOOLS.includes(n));
    expect(Object.keys(WORKSPACE_ARG_OPS).sort()).toEqual(domain.sort());
  });

  it("names only ops the tool really publishes", () => {
    for (const [tool, ops] of Object.entries(WORKSPACE_ARG_OPS)) {
      if (ops === null) continue;
      const enumOps = opsOf(tool);
      expect(enumOps, `${tool} declares ops but publishes no enum`).not.toBeNull();
      for (const op of ops) {
        expect(enumOps, `${tool}.${op} is not in the published enum`).toContain(op);
      }
    }
  });

  it("is the list/create shape on the four types whose ids resolve (B2)", () => {
    // ⚠ THE SET IS THE RULING, WRITTEN OUT. `dopl_kb(op="search")` is a LIST —
    // it has no ref to follow — and `dopl_chats(op="export")` MINTS one.
    expect(WORKSPACE_ARG_OPS.dopl_kb).toEqual(
      new Set(["list_bases", "create_base", "search"]),
    );
    expect(WORKSPACE_ARG_OPS.dopl_skill).toEqual(new Set(["list", "create"]));
    expect(WORKSPACE_ARG_OPS.dopl_agent).toEqual(new Set(["list", "create"]));
    expect(WORKSPACE_ARG_OPS.dopl_chats).toEqual(
      new Set(["list", "folders", "export", "create_folder"]),
    );
  });

  it("the five container-scoped tools take it on every call, and that is recorded", () => {
    // ⚠ THE DEVIATION FROM "list/create only", and it is not a resource
    // question: a channel, an ontology object, a member and a manifest are
    // properties OF a container, so no id can answer for them.
    for (const name of ["dopl_channel", "dopl_ontology", "dopl_members", "dopl_map", "dopl_search"]) {
      expect(WORKSPACE_ARG_OPS[name], name).toBeNull();
      expect(acceptsWorkspaceArg(name, "anything"), name).toBe(true);
    }
  });

  it("an unclassified tool honours it NOWHERE — fail closed", () => {
    expect(acceptsWorkspaceArg("dopl_invented", "list")).toBe(false);
  });
});

describe("a `workspace=` the op no longer takes is IGNORED, never refused", () => {
  it("runs the handler, does not route, and SAYS the arg was dropped", async () => {
    const { client } = build(true);
    // ⚠ A container-independent op with no loopback of its own, so the case is
    // about the WRAPPER and cannot go green or red on a stub's fixtures.
    const res = await tool("dopl_skill")({ op: "authoring_guide", workspace: "beta" });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain("workspace_arg: IGNORED on authoring_guide");
    // ⚠ The call stayed in the connection's container — the dropped arg did not
    // quietly re-target it, which is the one outcome a silent ignore allows.
    expect(text).toContain("active_workspace: `Alpha`");
    expect(client.listWorkspaces).not.toHaveBeenCalled();
  });

  it("a BLANK one is ignored too, on an op that does not take it", async () => {
    build(true);
    const res = await tool("dopl_skill")({ op: "authoring_guide", workspace: "  " });
    expect(res.isError).toBeFalsy();
  });

  it("but a blank one is still REFUSED where the op DOES take it", async () => {
    build(true);
    const res = await tool("dopl_map")({ workspace: "  " });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("blank");
  });
});
