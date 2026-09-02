/**
 * INVARIANT SUITE — MCP credits at the registrar seam. ⚠ The registrar's
 * `wrapped` is the ONLY exactly-once-per-tool-call seam (one tool call makes
 * 0..N loopback requests), so the three ways the charge can be wrong:
 *
 *   1. EXACTLY ONCE on BOTH terminal paths (session-default branch and
 *      `workspace=`-arg branch), against the RIGHT workspace id.
 *   2. EXHAUSTION HARD-BLOCKS: the handler never runs, and the refusal names
 *      the upgrade URL the server handed back.
 *   3. INFRASTRUCTURE FAILURE FAILS OPEN — a closed gate here bricks every
 *      agent in the product on a transient blip.
 *
 * ⚠ Plus the exemptions: meta-tools are never charged, and a call refused by an
 * earlier gate is not charged either — ordering is load-bearing and a refusal
 * must cost nothing.
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
    // ⚠ THE MCP RESOURCE SEAM (2026-09-02). `createServer` publishes
    // `dopl://doctrine/channels` through `registerResource` (`resources.ts`), so
    // a double without this method throws before a single tool is registered.
    // ⚠ IT IS A NO-OP HERE ON PURPOSE — these suites assert over TOOLS. The
    // resource's own content is pinned in `channel-doctrine.test.ts`, and that
    // it is registered at all in `server.test.ts`.
    registerResource() {}
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

  /**
   * ⚠ ONLY AN EXPLICIT `allowed === false` REFUSES. The fail-open promise covers
   * a THROWN error; a 200 whose body does not parse into our shape (proxy error
   * page, truncated response, future shape change) is the MORE likely failure,
   * and a truthiness test reads `undefined` as a refusal — fail-OPEN on the
   * rare path, fail-CLOSED on the common one.
   */
  it.each([
    ["a body with no `allowed` key", { used: 1, limit: 500, upgradeUrl: UPGRADE }],
    ["an empty object", {}],
    ["`allowed: undefined`", { ...allowed(), allowed: undefined }],
    ["`allowed` as a non-boolean", { ...allowed(), allowed: "true" }],
  ])("FAILS OPEN on %s — the tool call proceeds", async (_label, body) => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue(body);

    const res = await map({});
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).not.toContain("out of MCP credits");
    expect(client.listKbBases).toHaveBeenCalled();
  });

  it("FAILS OPEN on a null/absent body rather than refusing", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue(null);

    const res = await map({});
    expect(res.isError).toBeFalsy();
    expect(client.listKbBases).toHaveBeenCalled();
  });

  it("still refuses on an EXPLICIT false — the fix does not disarm the gate", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue({ ...allowed(), allowed: false });

    const res = await map({});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("out of MCP credits");
    expect(client.listKbBases).not.toHaveBeenCalled();
  });

  /**
   * 🔒 ⚠ THE FAIL-OPEN IS FOR TRANSPORT FAILURES, AND A GUEST IS NOT ONE
   * (2026-08-26, F-325). Until the consume route's floor came down to `guest`,
   * a guest-scoped call 403'd — and this `catch` turned that 403 into a FREE
   * tool call plus one `[credits] consume call failed` line per call. The route
   * now answers 200, and an unbillable container answers 200 `degraded` (the
   * service decides that, and LOGS it server-side).
   *
   * So the assertion is about the ERROR LOG, not about the tool result: a
   * degraded 200 must proceed like any other allowed answer and leave NO trace
   * here, because a trace here means the charge did not happen for a reason
   * this layer did not understand. Re-raising the route's floor puts the 403
   * back and this goes red — a plain "the call proceeded" test would not.
   */
  it("a degraded-but-ALLOWED 200 proceeds and logs NOTHING here", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue({
      ...allowed(0),
      used: 0,
      limit: 0,
      remaining: 0,
      degraded: true,
    });

    const res = await map({});
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).not.toContain("out of MCP credits");
    expect(client.listKbBases).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
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

  it("an app-only DELETE refusal fires first and costs nothing", async () => {
    // ⚠ ORDERING, made executable: the delete block is unconditional and must
    // never become reachable only after another gate — or a billing round trip
    // — lets the call through.
    // ⚠ Driven through `dopl_kb` since 2026-09-02: `dopl_kb_admin` and its four
    // siblings are deleted, and `delete-policy.ts › DELETE_BLOCKED_OPS` moved
    // onto the DOMAIN tools as the fence against a delete op coming back. The
    // op is not in the enum, so this call only exists at this layer — which is
    // exactly the layer the ordering claim is about.
    const { client } = build({ sole: true });
    const res = await tool("dopl_kb")({ op: "delete_base", baseId: "b-1" });
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
