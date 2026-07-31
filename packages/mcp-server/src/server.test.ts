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
  instructions: "",
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    constructor(_info: unknown, opts: { instructions?: string }) {
      registry.instructions = opts?.instructions ?? "";
    }
    tool(name: string, _d: string, _s: unknown, handler: Handler) {
      registry.tools.set(name, handler);
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
