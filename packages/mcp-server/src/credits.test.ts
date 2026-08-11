/**
 * INVARIANT SUITE — MCP credits at the registrar seam.
 *
 * The registrar's `wrapped` is the ONLY exactly-once-per-tool-call seam in the
 * product (a single tool call makes 0..N loopback requests), so the three
 * things pinned here are the three ways the charge can be wrong:
 *
 *   1. EXACTLY ONCE, on BOTH terminal paths — the session-default branch and
 *      the `workspace=`-arg branch — and against the RIGHT workspace id.
 *   2. EXHAUSTION HARD-BLOCKS: the handler never runs, and the refusal names
 *      the upgrade URL the server handed back.
 *   3. INFRASTRUCTURE FAILURE FAILS OPEN: a throwing consume call allows the
 *      tool call. A gate that failed closed here would brick every agent in
 *      the product on a transient blip.
 *
 * Plus the deliberate exemptions: meta-tools are never charged, and a call
 * refused by an earlier gate (M-3, a blank/unknown `workspace=`) is not
 * charged either — ordering is load-bearing, and a refusal must cost nothing.
 *
 * Same SDK mock as `server.test.ts`: `registerTool` only, deliberately not
 * `tool` (F-145).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

const registry = vi.hoisted(() => ({ tools: new Map<string, Handler>() }));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(name: string, _config: unknown, handler: Handler) {
      registry.tools.set(name, handler);
    }
  },
}));

import { createServer } from "./server.js";

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

const UPGRADE = "https://www.usedopl.com/billing?billing=upgrade";

function allowed(used = 1) {
  return {
    allowed: true,
    used,
    limit: 500,
    remaining: 500 - used,
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-09-01T00:00:00.000Z",
    upgradeUrl: UPGRADE,
  };
}

function exhausted() {
  return { ...allowed(500), allowed: false, remaining: 0 };
}

function mockClient(directory: WorkspaceListItem[]) {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: directory }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    consumeCredits: vi.fn().mockResolvedValue(allowed()),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ clusters: [], objects: {} }),
  } as unknown as DoplClient & {
    consumeCredits: ReturnType<typeof vi.fn>;
    listKbBases: ReturnType<typeof vi.fn>;
  };
}

/** Boot a session. `sole` gives it a session-default workspace; otherwise the
 *  caller must pass `workspace=` (the two terminal paths). */
function build(opts: { sole: boolean }) {
  registry.tools.clear();
  const directory = opts.sole ? [WS1] : [WS1, WS2];
  const client = mockClient(directory);
  createServer(client, {
    scopes: ["dopl.read", "dopl.write"],
    directory,
    workspace: opts.sole ? WS1 : null,
    role: opts.sole ? "owner" : null,
    workspaceSource: opts.sole ? "sole membership" : null,
  });
  const map = registry.tools.get("dopl_map");
  if (!map) throw new Error("dopl_map was not registered");
  return { map, client };
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

describe("exactly once, on both terminal paths", () => {
  it("charges the session default EXACTLY ONCE per tool call", async () => {
    const { map, client } = build({ sole: true });
    await map({});
    expect(client.consumeCredits).toHaveBeenCalledTimes(1);
    expect(client.consumeCredits).toHaveBeenCalledWith("id-1");
  });

  it("charges the RESOLVED workspace on the `workspace=` branch, once", async () => {
    const { map, client } = build({ sole: false });
    await map({ workspace: "beta" });
    expect(client.consumeCredits).toHaveBeenCalledTimes(1);
    expect(client.consumeCredits).toHaveBeenCalledWith("id-2");
  });

  it("charges once PER CALL — three calls, three credits", async () => {
    const { map, client } = build({ sole: true });
    await map({});
    await map({});
    await map({});
    expect(client.consumeCredits).toHaveBeenCalledTimes(3);
  });

  it("charges BEFORE the handler runs", async () => {
    const order: string[] = [];
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockImplementation(async () => {
      order.push("charge");
      return allowed();
    });
    client.listKbBases.mockImplementation(async () => {
      order.push("handler");
      return [];
    });
    await map({});
    expect(order[0]).toBe("charge");
    expect(order).toContain("handler");
  });
});

describe("exhaustion", () => {
  it("refuses the call, names the upgrade URL, and never runs the handler", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue(exhausted());

    const res = await map({});
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("out of MCP credits");
    expect(text).toContain(`Upgrade to continue: ${UPGRADE}`);
    expect(client.listKbBases).not.toHaveBeenCalled();
  });

  it("refuses on the `workspace=` branch too", async () => {
    const { map, client } = build({ sole: false });
    client.consumeCredits.mockResolvedValue(exhausted());

    const res = await map({ workspace: "beta" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("out of MCP credits");
    expect(client.listKbBases).not.toHaveBeenCalled();
  });

  it("still refuses when the server sent no upgrade url — message, no dangling link", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue({ ...exhausted(), upgradeUrl: "" });

    const text = textOf(await map({}));
    expect(text).toContain("out of MCP credits");
    expect(text).not.toContain("Upgrade to continue:");
  });
});

describe("fail direction", () => {
  it("FAILS OPEN when the consume call throws — the tool call proceeds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockRejectedValue(new Error("loopback refused"));

    const res = await map({});
    expect(res.isError).toBeFalsy();
    expect(client.listKbBases).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("what is NOT charged", () => {
  it("meta-tools are exempt — `current_workspace` costs nothing", async () => {
    const { client } = build({ sole: true });
    await tool("current_workspace")({});
    expect(client.consumeCredits).not.toHaveBeenCalled();
  });

  it("`list_workspaces` is exempt too", async () => {
    const { client } = build({ sole: true });
    await tool("list_workspaces")({});
    expect(client.consumeCredits).not.toHaveBeenCalled();
  });

  it("an app-only DELETE refusal (§10) fires first and costs nothing", async () => {
    // The ordering claim, made executable: the delete block is unconditional
    // and must not become reachable only after some other gate — or after a
    // billing round trip — lets the call through.
    const { client } = build({ sole: true });
    const res = await tool("dopl_kb_admin")({ op: "delete_base", baseId: "b-1" });
    expect(res.isError).toBe(true);
    expect(client.consumeCredits).not.toHaveBeenCalled();
  });

  it("a call refused for having no default workspace (M-3) is not charged", async () => {
    const { map, client } = build({ sole: false });
    const res = await map({});
    expect(res.isError).toBe(true);
    expect(client.consumeCredits).not.toHaveBeenCalled();
  });

  it("a blank `workspace=` is refused before any charge", async () => {
    const { map, client } = build({ sole: false });
    const res = await map({ workspace: "   " });
    expect(res.isError).toBe(true);
    expect(client.consumeCredits).not.toHaveBeenCalled();
  });

  it("an unknown `workspace=` ref is refused before any charge", async () => {
    const { map, client } = build({ sole: false });
    const res = await map({ workspace: "does-not-exist" });
    expect(res.isError).toBe(true);
    expect(client.consumeCredits).not.toHaveBeenCalled();
  });
});
