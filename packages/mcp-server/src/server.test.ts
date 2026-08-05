/**
 * NET-NEW (MCP-2) — createServer workspace targeting + footer.
 *
 * The SDK `McpServer` is mocked so we can capture each tool's wrapped
 * handler and drive it directly. Covers the wrapper enforcement (M-3) and
 * the mandatory-effective `_dopl_status` footer with source label (M-4)
 * across 0 / 1 / 2+ memberships, plus `buildInstructions` (M-2).
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
  instructions: "",
}));

/**
 * The mock exposes `registerTool` and DELIBERATELY NOT `tool` (F-145). The
 * positional `tool()` overload cannot carry a built schema — the SDK reads a
 * schema instance as annotations and throws — so it is the one API through
 * which the strict input schema silently degrades back to "unknown keys are
 * dropped". A regression to it does not quietly re-register here; it is a
 * TypeError naming the method.
 */
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    constructor(_info: unknown, opts: { instructions?: string }) {
      registry.instructions = opts?.instructions ?? "";
    }
    registerTool(
      name: string,
      config: { description?: string; inputSchema?: unknown },
      handler: Handler,
    ) {
      registry.tools.set(name, handler);
      registry.schemas.set(name, config?.inputSchema);
    }
  },
}));

import { createServer, buildInstructions } from "./server.js";

function wsItem(
  id: string,
  slug: string,
  name: string,
  role: WorkspaceListItem["role"],
  description: string | null = null,
): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name,
    slug,
    publicId: `pub-${id}`,
    description,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role,
  };
}

const WS1 = wsItem("id-1", "alpha", "Alpha", "owner", "first ws");
const WS2 = wsItem("id-2", "beta", "Beta", "member", "second ws");

function mockClient(directory: WorkspaceListItem[]): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: directory }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    listClusters: vi.fn().mockResolvedValue({ clusters: [] }),
    listWorkflows: vi.fn().mockResolvedValue({ workflows: [] }),
    getOntology: vi.fn().mockResolvedValue({ clusters: [], objects: {} }),
  } as unknown as DoplClient;
}

function build(options: Parameters<typeof createServer>[1]) {
  registry.tools.clear();
  registry.schemas.clear();
  const client = mockClient(options?.directory ?? []);
  createServer(client, { scopes: ["dopl.read", "dopl.write"], ...options });
  const map = registry.tools.get("dopl_map");
  if (!map) throw new Error("dopl_map was not registered");
  return { map, client };
}

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildInstructions (M-2)", () => {
  it("0 memberships → tells the agent it has none", () => {
    expect(buildInstructions([])).toContain("not an active member of any workspace");
  });

  it("1 membership → may omit workspace=, bakes the workspace in", () => {
    const out = buildInstructions([WS1]);
    expect(out).toContain("exactly one workspace");
    expect(out).toMatch(/omit .*workspace=/);
    expect(out).toContain("`alpha`");
  });

  it("2+ memberships → MUST pass workspace= on every call, lists all with descriptions", () => {
    const out = buildInstructions([WS1, WS2]);
    expect(out).toContain("member of 2 workspaces");
    expect(out).toContain("EVERY tool call");
    expect(out).toContain("`alpha`");
    expect(out).toContain("`beta`");
    expect(out).toContain("second ws");
  });

  it("2+ memberships WITH a resolved pin → says pinned-by-default, not 'pass on every call'", () => {
    const out = buildInstructions([WS1, WS2], {
      pin: { name: "Beta", slug: "beta" },
    });
    expect(out).toContain("pinned to `Beta`");
    expect(out).toContain("no-arg tool call targets it");
    expect(out).not.toContain("NO default");
  });

  it("0 memberships with a transient load failure → 'couldn't load', not 'you have none'", () => {
    const out = buildInstructions([], { directoryLoadFailed: true });
    expect(out).toContain("couldn't load");
    expect(out).not.toContain("not an active member of any workspace");
  });
});

describe("no-arg call (M-3 wrapper enforcement)", () => {
  it("2+ memberships, no default → refuses and lists the workspaces (handler never runs)", async () => {
    const { map, client } = build({
      directory: [WS1, WS2],
      workspace: null,
      role: null,
      workspaceSource: null,
    });
    const res = await map({});
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("no default workspace");
    expect(text).toContain("`alpha`");
    expect(text).toContain("`beta`");
    // The real handler must not have executed.
    expect(client.listKbBases).not.toHaveBeenCalled();
  });

  it("0 memberships, no default → refuses with a 'not a member' message", async () => {
    const { map } = build({
      directory: [],
      workspace: null,
      role: null,
      workspaceSource: null,
    });
    const res = await map({});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("not an active member of any workspace");
  });

  it("sole membership → runs and footers `sole membership`", async () => {
    const { map, client } = build({
      directory: [WS1],
      workspace: WS1,
      role: "owner",
      workspaceSource: "sole membership",
    });
    const res = await map({});
    expect(res.isError).toBeFalsy();
    expect(client.listKbBases).toHaveBeenCalled();
    const text = textOf(res);
    expect(text).toContain("active_workspace: `Alpha`");
    expect(text).toContain("workspace_source: sole membership");
  });

  it("header pin → footers `header pin`", async () => {
    const { map } = build({
      directory: [WS1, WS2],
      workspace: WS2,
      role: "member",
      workspaceSource: "header pin",
    });
    const res = await map({});
    const text = textOf(res);
    expect(text).toContain("active_workspace: `Beta`");
    expect(text).toContain("workspace_source: header pin");
  });
});

describe("per-call workspace= (M-4 footer)", () => {
  it("resolves the ref, runs, and footers `per-call arg`", async () => {
    const { map } = build({
      directory: [WS1, WS2],
      workspace: null,
      role: null,
      workspaceSource: null,
    });
    const res = await map({ workspace: "beta" });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain("active_workspace: `Beta`");
    expect(text).toContain("workspace_source: per-call arg");
  });

  it("rejects a blank workspace= without running the handler", async () => {
    const { map, client } = build({
      directory: [WS1, WS2],
      workspace: null,
      role: null,
      workspaceSource: null,
    });
    const res = await map({ workspace: "   " });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("blank");
    expect(client.listKbBases).not.toHaveBeenCalled();
  });

  it("errors on an unknown workspace ref", async () => {
    const { map } = build({
      directory: [WS1, WS2],
      workspace: null,
      role: null,
      workspaceSource: null,
    });
    const res = await map({ workspace: "does-not-exist" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("Workspace not found");
  });
});

// ── Identity + locus: WHO is calling, not just WHERE it landed ──────────
//
// The footer is the one line that rides every successful response and that the
// instructions tell the agent to read. It named the workspace and said nothing
// about the caller, so an agent that needed to know which session it was had to
// go looking — and the surfaces it would have found answered from three
// different sources that could disagree inside one connection.

const CALLER = {
  userId: "u-me",
  runtime: "desktop-session",
  credentialKind: "device" as const,
  credentialLabel: "Dopl Desktop CLI (mbp.local)",
};

/** A tool captured from the registry by name (the meta-tools aren't in `build`). */
function tool(name: string): Handler {
  const h = registry.tools.get(name);
  if (!h) throw new Error(`${name} was not registered`);
  return h;
}

describe("_dopl_status — the caller line", () => {
  it("carries the caller's immutable user id on every successful response", async () => {
    const { map } = build({
      directory: [WS1],
      workspace: WS1,
      role: "owner",
      workspaceSource: "sole membership",
      caller: CALLER,
    });
    expect(textOf(await map({}))).toContain("caller: id=`u-me` · runtime=desktop-session");
  });

  it("rides a per-call `workspace=` response too, not just the session default", async () => {
    const { map } = build({
      directory: [WS1, WS2],
      workspace: null,
      role: null,
      workspaceSource: null,
      caller: CALLER,
    });
    expect(textOf(await map({ workspace: "beta" }))).toContain("caller: id=`u-me`");
  });

  it("comes BEFORE the workspace, because who precedes where", async () => {
    const { map } = build({
      directory: [WS1],
      workspace: WS1,
      role: "owner",
      workspaceSource: "sole membership",
      caller: CALLER,
    });
    const text = textOf(await map({}));
    expect(text.indexOf("caller:")).toBeLessThan(text.indexOf("active_workspace:"));
  });

  it("says unresolved rather than inventing an id when boot could not confirm one", async () => {
    const { map } = build({
      directory: [WS1],
      workspace: WS1,
      role: "owner",
      workspaceSource: "sole membership",
    });
    expect(textOf(await map({}))).toContain("caller: id=(unresolved");
  });

  /** The hostname is a whoami answer, not a per-response tax on every result. */
  it("keeps the credential label OUT of the footer", async () => {
    const { map } = build({
      directory: [WS1],
      workspace: WS1,
      role: "owner",
      workspaceSource: "sole membership",
      caller: CALLER,
    });
    expect(textOf(await map({}))).not.toContain("mbp.local");
  });
});

describe("current_workspace — the tool an agent reaches for when it is lost", () => {
  /**
   * The 2+-membership branch is the one that needed this most and had it least:
   * `appendDoplStatus` skips the footer entirely when there is no effective
   * workspace, so this branch carried no identity AND printed slugs with no
   * workspace ids beside them.
   */
  it("states the caller and the workspace IDS when there is no auto-target", async () => {
    build({ directory: [WS1, WS2], workspace: null, role: null, workspaceSource: null, caller: CALLER });
    const text = textOf(await tool("current_workspace")({}));
    expect(text).toContain("caller: id=`u-me` · runtime=desktop-session");
    expect(text).toContain("id: `id-1`");
    expect(text).toContain("id: `id-2`");
  });

  it("names the credential this session acts through", async () => {
    build({ directory: [WS1, WS2], workspace: null, role: null, workspaceSource: null, caller: CALLER });
    const text = textOf(await tool("current_workspace")({}));
    expect(text).toContain("a device token");
    expect(text).toContain("mbp.local");
  });

  /**
   * On the auto-target branch the footer fires and carries the caller, so the
   * body must NOT restate it — one caller line per response, wherever it comes
   * from.
   */
  it("states the caller exactly once on the auto-target branch", async () => {
    build({
      directory: [WS1],
      workspace: WS1,
      role: "owner",
      workspaceSource: "sole membership",
      caller: CALLER,
    });
    const text = textOf(await tool("current_workspace")({}));
    expect(text).toContain("A no-`workspace=` call targets");
    expect(text.split("\n").filter((l) => l.includes("caller: id="))).toHaveLength(1);
  });

  it("states the caller exactly once on the no-auto-target branch too", async () => {
    build({ directory: [WS1, WS2], workspace: null, role: null, workspaceSource: null, caller: CALLER });
    const text = textOf(await tool("current_workspace")({}));
    expect(text.split("\n").filter((l) => l.includes("caller: id="))).toHaveLength(1);
  });
});

describe("buildInstructions — identity is taught before the first tool call", () => {
  it("names the footer's caller key as the agent's identity", () => {
    expect(buildInstructions([WS1])).toContain("caller: id=<your user id>");
  });

  it("tells the agent to match on the id, not the display name", () => {
    expect(buildInstructions([WS1])).toContain("a name alone never settles");
  });

  /**
   * The line that pointed at the anchor for "who the caller is" is what made an
   * agent read a member-typed object NAME as its own identity. It points at
   * whoami now, and calls the anchor context.
   */
  it("reframes the ontology anchor as context, not identity", () => {
    const text = buildInstructions([WS1]);
    expect(text).toContain("CONTEXT about them, not their identity");
    expect(text).not.toContain("to learn who the caller is in the workspace graph");
  });

  it("refuses the same-machine question up front", () => {
    const text = buildInstructions([WS1]);
    expect(text).toContain("a different user id is a different ACCOUNT");
    expect(text).toContain("do not assert it either way");
  });
});
