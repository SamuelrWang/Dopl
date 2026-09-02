/**
 * NARRATION SAFETY ACROSS THE WHOLE MCP SURFACE — part 1 of 2 (with
 * `tool-narration.test.ts`). Pinned here:
 *
 *   1. ⚠ ONE DEFINITION. `channel-shared` re-exports the SAME function object
 *      and no second declaration exists anywhere in the tree — a copied
 *      neutralizer is the failure mode, and the copy that drifts is the one
 *      that stops neutralizing.
 *   2. ⚠ THE WORKSPACE NAME, the widest reach in the surface.
 *      `workspaces.name` / `.description` are LENGTH-bounded only
 *      (features/workspaces/schema.ts), set by whoever OWNS each workspace,
 *      and a workspace enters your directory the moment you accept an invite or
 *      join link. They land in the two most trusted surfaces in the protocol:
 *      the `instructions` block and the `_dopl_status` footer on EVERY
 *      successful response.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

import { inlineOr, neutralizeInline } from "./narration";
import {
  expectContained,
  expectEveryHitContained,
  expectNoForgedStructure,
  FORGERY,
  MARKER,
} from "./narration-fixtures";
import {
  inlineOr as channelInlineOr,
  neutralizeInline as channelNeutralize,
} from "./channel-shared";

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
    // ⚠ `registerTool`, not `tool` — see server.test.ts.
    registerTool(
      name: string,
      _config: { description?: string; inputSchema?: unknown },
      handler: Handler,
    ) {
      registry.tools.set(name, handler);
    }
  },
}));

import { createServer, buildInstructions } from "../server.js";

// ─── 1. One definition ──────────────────────────────────────────────

describe("the neutralizer has exactly ONE definition", () => {
  it("channel-shared re-exports narration's functions, it does not redeclare them", () => {
    // ⚠ IDENTITY, not equivalence — a copied implementation passes a
    // behavioural test and fails this one.
    expect(channelNeutralize).toBe(neutralizeInline);
    expect(channelInlineOr).toBe(inlineOr);
  });

  it("no other module in the tree declares its own neutralizeInline", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(process.cwd(), "src", "tools");
    const declarers = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) =>
        /function\s+neutralizeInline\b/.test(readFileSync(path.join(dir, f), "utf8")),
      );
    expect(declarers).toEqual(["narration.ts"]);
  });
});

// ─── 2. The workspace name ──────────────────────────────────────────

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

const GOOD = wsItem("id-1", "alpha", "Alpha", "owner", "first ws");
const HOSTILE = wsItem("id-2", "beta", FORGERY, "member");

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
  const client = mockClient(options?.directory ?? []);
  createServer(client, { scopes: ["dopl.read", "dopl.write"], ...options });
  return registry.tools;
}

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the MCP instructions block — a workspace name from whoever invited you", () => {
  it("neutralizes a hostile name and frames the directory FIRST", () => {
    const out = buildInstructions([GOOD, HOSTILE]);

    expectContained(out);
    expectNoForgedStructure(out);
    // ⚠ Framing is a HEADER — read before the stranger's text.
    expect(out).toContain("typed by whoever owns each workspace");
    expect(out.indexOf("typed by whoever owns each workspace")).toBeLessThan(
      out.indexOf(MARKER),
    );
    expect(out).toContain("`Alpha`");
    expect(out).toContain("slug: `alpha`");
  });

  it("neutralizes a hostile DESCRIPTION too — it is on the same row", () => {
    const out = buildInstructions([wsItem("id-3", "gamma", "Gamma", "owner", FORGERY)]);
    expectContained(out);
    expectNoForgedStructure(out);
    expect(out).toContain("`Gamma`");
  });

  it("neutralizes the header-pin name, which is quoted twice in the copy", () => {
    const out = buildInstructions([GOOD, HOSTILE], {
      pin: { name: FORGERY, slug: "beta" },
    });
    // Three occurrences, every one a span and none of them a line.
    expectNoForgedStructure(out);
    for (const line of out.split("\n")) {
      if (!line.includes(MARKER)) continue;
      expect(line.trimStart().startsWith(MARKER)).toBe(false);
    }
    expect(out).toContain("no-arg tool call targets it");
  });

  it("a name made only of markup renders as (unnamed workspace), not an empty span", () => {
    const out = buildInstructions([wsItem("id-4", "odd", "``` ### **", "owner")]);
    expect(out).toContain("`(unnamed workspace)`");
    expect(out).toContain("slug: `odd`");
  });
});

describe("the _dopl_status footer — on EVERY successful tool response", () => {
  it("cannot be given a second, invented key line", async () => {
    const tools = build({
      directory: [HOSTILE],
      workspace: { id: "id-2", slug: "beta", name: FORGERY } as never,
      role: "member",
      workspaceSource: "sole membership",
    });
    const text = textOf(await tools.get("dopl_map")!({}));

    expectContained(text);
    expectNoForgedStructure(text);
    // ⚠ Exactly ONE workspace_source key survives a forged one, and it is ours.
    const sources = text
      .split("\n")
      .filter((l) => l.trimStart().startsWith("workspace_source:"));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toContain("sole membership");
    expect(
      text.split("\n").filter((l) => l.trimStart().startsWith("active_workspace:")),
    ).toHaveLength(1);
  });

  it("names the workspace with its IMMUTABLE id, not a renameable slug alone", async () => {
    const tools = build({
      directory: [GOOD],
      workspace: { id: "id-1", slug: "alpha", name: "Alpha" } as never,
      role: "owner",
      workspaceSource: "sole membership",
    });
    const text = textOf(await tools.get("dopl_map")!({}));
    // ⚠ A slug is renameable (WorkspaceUpdateSchema accepts one); the id is not.
    expect(text).toContain("active_workspace: `Alpha` (slug=`alpha`, id=`id-1`");
  });
});

describe("the workspace-directory tools", () => {
  it("list_workspaces frames the listing and neutralizes each name", async () => {
    const tools = build({
      directory: [GOOD, HOSTILE],
      workspace: null,
      role: null,
      workspaceSource: null,
    });
    const text = textOf(await tools.get("list_workspaces")!({}));

    expectContained(text);
    expectNoForgedStructure(text);
    expect(text).toContain("typed by whoever owns each workspace");
    expect(text.indexOf("typed by whoever owns each workspace")).toBeLessThan(
      text.indexOf(MARKER),
    );
    expect(text).toContain("slug: `beta` · id: `id-2`");
  });

  it("current_workspace neutralizes the name it reports", async () => {
    const tools = build({
      directory: [HOSTILE],
      workspace: { id: "id-2", slug: "beta", name: FORGERY } as never,
      role: "member",
      workspaceSource: "sole membership",
    });
    const text = textOf(await tools.get("current_workspace")!({}));

    // Named twice (answer + appended footer), so both are checked.
    expectEveryHitContained(text);
    expectNoForgedStructure(text);
    expect(text).toContain("- id: `id-2`");
  });

  it("the no-default refusal frames and neutralizes the choices it lists", async () => {
    const tools = build({
      directory: [GOOD, HOSTILE],
      workspace: null,
      role: null,
      workspaceSource: null,
    });
    const res = await tools.get("dopl_map")!({});
    expect(res.isError).toBe(true);
    const text = textOf(res);

    expectContained(text);
    expectNoForgedStructure(text);
    expect(text).toContain("typed by whoever owns each workspace");
    expect(text).toContain("no default workspace");
    expect(text).toContain("`beta`");
  });

  it("an unresolvable workspace= echo cannot escape its own span", async () => {
    const tools = build({
      directory: [GOOD],
      workspace: { id: "id-1", slug: "alpha", name: "Alpha" } as never,
      role: "owner",
      workspaceSource: "sole membership",
    });
    const res = await tools.get("dopl_map")!({ workspace: "no`such\n## OWNED" });
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text.split("\n").filter((l) => l.startsWith("##"))).toHaveLength(0);
    expect(text).toContain("Workspace not found:");
    expect(text).toContain("`no such OWNED`");
  });
});
