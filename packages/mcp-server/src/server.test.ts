/**
 * createServer workspace targeting + footer. The SDK `McpServer` is mocked so
 * each tool's wrapped handler can be captured and driven directly: wrapper
 * enforcement and the mandatory-effective `_dopl_status` footer with source
 * label across 0 / 1 / 2+ memberships, plus `buildInstructions`.
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
 * ⚠ Exposes `registerTool` and DELIBERATELY NOT `tool`. The positional `tool()`
 * overload cannot carry a built schema (the SDK reads a schema instance as
 * annotations and throws), so it is the one API through which the strict input
 * schema silently degrades to "unknown keys are dropped" — a regression to it
 * is a TypeError naming the method, not a quiet re-registration.
 */
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
import { WORKSPACE_ARG_DESCRIPTION } from "./registrar.js";

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
    expect(buildInstructions([])).toContain("not an active member of any container");
  });

  /**
   * ⚠ **NO SENTENCE ABOUT A DEFAULT WORKSPACE SURVIVES B10, IN EITHER
   * DIRECTION.** The briefing used to branch on the membership COUNT — one
   * workspace "so every call targets it", 2+ and "`workspace=` REQUIRED on
   * EVERY call, a no-arg call is refused". Both sentences described the same
   * deleted mechanism, so the count stops appearing at all: what an agent needs
   * is whether THIS connection is bound to a container.
   */
  it("names no default and demands nothing, whatever the membership count", () => {
    for (const dir of [[WS1], [WS1, WS2]]) {
      const out = buildInstructions(dir);
      expect(out).toContain("This connection names no container");
      expect(out).not.toMatch(/default workspace|REQUIRED on EVERY call/);
    }
  });

  it("lists every container it was given, with descriptions", () => {
    const out = buildInstructions([WS1, WS2]);
    expect(out).toContain("`alpha`");
    expect(out).toContain("`beta`");
    expect(out).toContain("second ws");
  });

  it("a bound connection says WHERE it is, once", () => {
    const out = buildInstructions([WS1, WS2], {
      pin: { name: "Beta", slug: "beta" },
    });
    expect(out).toContain("This connection is in `Beta`");
    expect(out).toContain("every call lands there unless it names another");
  });

  it("0 memberships with a transient load failure → 'couldn't load', not 'you have none'", () => {
    const out = buildInstructions([], { directoryLoadFailed: true });
    expect(out).toContain("did not load");
    expect(out).not.toContain("not an active member of any container");
  });
});

describe("a no-arg call is ANSWERED, never refused (B10)", () => {
  /**
   * ⚠ **THE M-3 REFUSAL IS DELETED, AND THAT IS THE WHOLE OF B10 AT THIS
   * LAYER.** A caller in 2+ workspaces used to be told "this connection has no
   * default workspace … pick one" before the handler ran. There is no default
   * to lack: the call goes through with no `X-Workspace-Id`, and the SERVER
   * answers with the caller's own container.
   */
  it("2+ memberships, nothing bound → RUNS the handler rather than refusing", async () => {
    const { map, client } = build({
      directory: [WS1, WS2],
      workspace: null,
      role: null,
      workspaceSource: null,
    });
    const res = await map({});
    expect(res.isError).toBeFalsy();
    expect(client.listKbBases).toHaveBeenCalled();
  });

  it("0 memberships → still runs; there is nothing here that can refuse", async () => {
    const { map } = build({
      directory: [],
      workspace: null,
      role: null,
      workspaceSource: null,
    });
    expect((await map({})).isError).toBeFalsy();
  });

  /**
   * ⚠ The footer is the ONE line riding every successful response, and the
   * briefing tells every agent to read its `caller:` key. An unbound connection
   * has no workspace to name and must not lose its identity with it.
   */
  it("an unbound connection still footers the CALLER, with no workspace lines", async () => {
    const { map } = build({
      directory: [WS1, WS2],
      workspace: null,
      role: null,
      workspaceSource: null,
      caller: CALLER,
    });
    const text = textOf(await map({}));
    expect(text).toContain("caller: id=`u-me`");
    expect(text).not.toContain("active_workspace:");
    expect(text).not.toContain("workspace_source:");
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
// ⚠ The footer is the one line riding every successful response that the
// instructions tell the agent to read. Without the caller on it, an agent that
// needs to know which session it is goes looking across surfaces answering from
// sources that can disagree inside one connection.

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
      workspaceSource: "header pin",
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
      workspaceSource: "header pin",
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
      workspaceSource: "header pin",
    });
    expect(textOf(await map({}))).toContain("caller: id=(unresolved");
  });

  /** The hostname is a whoami answer, not a per-response tax on every result. */
  it("keeps the credential label OUT of the footer", async () => {
    const { map } = build({
      directory: [WS1],
      workspace: WS1,
      role: "owner",
      workspaceSource: "header pin",
      caller: CALLER,
    });
    expect(textOf(await map({}))).not.toContain("mbp.local");
  });
});

describe("dopl_workspaces — the tool an agent reaches for when it is lost", () => {
  /**
   * ⚠ An unbound connection needs this most: `appendDoplStatus` has no
   * workspace to name, so without a body line the answer would print slugs with
   * no ids and no identity at all.
   */
  it("states the caller and the container IDS when nothing is bound", async () => {
    build({ directory: [WS1, WS2], workspace: null, role: null, workspaceSource: null, caller: CALLER });
    const text = textOf(await tool("dopl_workspaces")({}));
    expect(text).toContain("caller: id=`u-me` · runtime=desktop-session");
    expect(text).toContain("id: `id-1`");
    expect(text).toContain("id: `id-2`");
  });

  it("names the credential this session acts through", async () => {
    build({ directory: [WS1, WS2], workspace: null, role: null, workspaceSource: null, caller: CALLER });
    const text = textOf(await tool("dopl_workspaces")({}));
    expect(text).toContain("a device token");
    expect(text).toContain("mbp.local");
  });

  /**
   * ⚠ When the connection IS bound the footer fires and carries the caller, so
   * the body must NOT restate it — ONE caller line per response.
   */
  it("states the caller exactly once whether or not a container is bound", async () => {
    for (const bound of [true, false]) {
      build({
        directory: [WS1, WS2],
        workspace: bound ? WS1 : null,
        role: bound ? "owner" : null,
        workspaceSource: bound ? "header pin" : null,
        caller: CALLER,
      });
      const text = textOf(await tool("dopl_workspaces")({}));
      expect(text.split("\n").filter((l) => l.includes("caller: id="))).toHaveLength(1);
    }
  });

  it("marks the bound container, and says so plainly when there is none", async () => {
    build({ directory: [WS1, WS2], workspace: WS1, role: "owner", workspaceSource: "header pin" });
    expect(textOf(await tool("dopl_workspaces")({}))).toContain(
      "← this connection's container",
    );
    build({ directory: [WS1, WS2], workspace: null, role: null, workspaceSource: null });
    expect(textOf(await tool("dopl_workspaces")({}))).toContain(
      "This connection names no container",
    );
  });

  /**
   * 🔒 §4A, kept by RENDERING rather than by hiding. B10 lists containers
   * beside workspaces; what must never happen is one being CALLED a workspace,
   * or its slug published as an address.
   */
  it("lists a home-channel container by KIND and by id, never by slug", async () => {
    const container = wsItem("id-3", "room-seg", "With Dana", "owner");
    container.kind = "link";
    build({ directory: [WS1, container], workspace: null, role: null, workspaceSource: null });
    const text = textOf(await tool("dopl_workspaces")({}));
    expect(text).toContain("`With Dana` — home channel (id: `id-3`");
    expect(text).not.toContain("slug: `room-seg`");
    expect(text).toContain("`Alpha` — workspace (slug: `alpha`");
  });
});

describe("buildInstructions — identity is taught before the first tool call", () => {
  it("names the footer's caller key as the agent's identity", () => {
    expect(buildInstructions([WS1])).toContain("caller: id=<your user id>");
  });

  it("tells the agent to match on the id, not the display name", () => {
    expect(buildInstructions([WS1])).toContain("two members can share a display name");
  });

  /**
   * ⚠ Pointing at the ANCHOR for "who the caller is" makes an agent read a
   * member-typed object NAME as its own identity — point at whoami, which is
   * the op that answers it. ⚠ REWRITTEN FOR THE 2,048-CHAR BUDGET (A1): the
   * briefing no longer carries the anchor paragraph at all, so the claim it can
   * still make is that identity resolves to `whoami` and to nothing else. The
   * anchor's own framing is pinned where it renders (`tools/ontology.ts`).
   */
  it("sends 'who am I' to whoami, and nowhere near the ontology anchor", () => {
    const text = buildInstructions([WS1]);
    expect(text).toContain("dopl_members(op='whoami')");
    expect(text).not.toContain("anchor");
    expect(text).not.toContain("to learn who the caller is in the workspace graph");
  });
});

// ── The injected `workspace` arg — one short contract, not fourteen copies ───
//
// ⚠ THIS ONE DESCRIPTION IS MULTIPLIED BY THE DOMAIN-TOOL COUNT ON EVERY
// CONNECTION, before an agent has called anything. It was a 717-char paragraph
// across 14 tools — ~10,000 served chars, measured 2026-09-02 — restating the
// rule `instructions.ts` states once. That is the cost this pair of cases
// exists to keep from growing back (C9).

/**
 * ⚠ A CEILING THAT ONLY EVER MOVES DOWN, exactly like `tool-budget.test.ts`'s
 * description ratchet. Raising it is how a budget stops being a budget: the
 * rule belongs in the instructions, which are pushed ONCE.
 */
const WORKSPACE_ARG_MAX_CHARS = 96;

/**
 * The meta tools. ⚠ `registerMetaTool` injects NO `workspace` arg — an
 * account-wide lookup is user-scoped — so they are the complement of the set
 * that must carry the injected string, and deriving the expectation that way
 * keeps this case honest as domain tools are added or deleted.
 */
const META_TOOLS = ["dopl_workspaces", "dopl_status"];

/** The `workspace` arg's served description, read off the registered schema. */
function workspaceArgOf(schema: unknown): string | undefined {
  const shape = (schema as { shape?: Record<string, { description?: string }> })?.shape;
  return shape?.workspace?.description;
}

describe("the injected `workspace` arg (C9)", () => {
  beforeEach(() => {
    build({
      directory: [WS1],
      workspace: WS1,
      role: "owner",
      workspaceSource: "header pin",
    });
  });

  it(`is a contract, not a paragraph — ≤ ${WORKSPACE_ARG_MAX_CHARS} chars`, () => {
    expect(WORKSPACE_ARG_DESCRIPTION.length).toBeLessThanOrEqual(WORKSPACE_ARG_MAX_CHARS);
    // Both container kinds are addressable through this one arg, and a trim
    // that deletes either half makes the shorter string a wrong string.
    expect(WORKSPACE_ARG_DESCRIPTION).toContain("home-channel container");
    expect(WORKSPACE_ARG_DESCRIPTION).toContain("omit");
    // ⚠ THE RETIREMENT CLAUSE IS PART OF THE CONTRACT (B13). Without it the arg
    // is a promise the registrar no longer keeps on most ops.
    expect(WORKSPACE_ARG_DESCRIPTION).toContain("Ignored");
  });

  it("does not restate what `instructions.ts` states once", () => {
    // ⚠ Discovery (`dopl_workspaces`) and the targeting rule are the
    // instructions' job. Naming them here pays for them once per domain tool,
    // which is the defect C9 names.
    expect(WORKSPACE_ARG_DESCRIPTION).not.toMatch(/dopl_workspaces|REQUIRED/);
  });

  it("is the byte-identical string on every domain tool — 9 of them today", () => {
    const carrying = [...registry.schemas]
      .filter(([, schema]) => workspaceArgOf(schema) === WORKSPACE_ARG_DESCRIPTION)
      .map(([name]) => name);
    // A scan over nothing is not a guard.
    expect(carrying.length).toBeGreaterThan(5);
    expect(carrying.sort()).toEqual(
      [...registry.schemas.keys()].filter((n) => !META_TOOLS.includes(n)).sort(),
    );
  });

  it("is NOT injected onto the meta path — neither meta tool carries one", () => {
    // ⚠ The meta path must never grow the domain path's routing contract: an
    // account-wide answer cannot be scoped to one container, so an argument
    // saying it could would only ever be wrong.
    for (const name of META_TOOLS) {
      expect(workspaceArgOf(registry.schemas.get(name)), name).toBeUndefined();
    }
  });
});
