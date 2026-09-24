/**
 * INVARIANT SUITE — 🔒 **AN UNCHARGED TOOL CALL SAYS SO** (2026-09-14 review).
 *
 * ⚠ **THE BUG THIS SUITE IS THE ANSWER TO IS A SILENCE, NOT A FAILURE.** Ship the
 * web ahead of its migration and `POST /api/mcp/credits/consume` cannot find the
 * RPC signature — `PGRST202`, which the route catches and FAILS OPEN on,
 * answering `{ allowed: true, degraded: true, wallet: null }`. Every MCP tool
 * call in the estate then runs free. Before this wave the registrar read
 * `allowed !== false`, returned `null`, and nothing anywhere said a word.
 *
 * ⚠ **TWO DIFFERENT CADENCES, AND MIXING THEM UP IS THE WHOLE DESIGN.** The LOG
 * fires ONCE PER PROCESS PER REASON — a deploy-ordering bug is a STATE, and one
 * line per tool call per agent buries the line that says what broke. The FOOTER
 * NOTE rides EVERY affected call, because it is a fact about that call and the
 * agent reads that footer by instruction.
 *
 * ⚠ **THE PER-CALL HALF IS AN `AsyncLocalStorage`, AND THE CONCURRENCY CASE IS
 * WHY.** One process serves overlapping tool calls; a module-level "last reason"
 * puts one call's note on another call's footer, which is worse than no note at
 * all. That case is the mutation this file was written against.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import {
  joinNotes,
  NOTE_PREFIX,
  resetUnmeteredLogForTests,
} from "./credits-unmetered";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

const registry = vi.hoisted(() => ({ tools: new Map<string, Handler>() }));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
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

const CHARGED = {
  allowed: true,
  used: 1,
  limit: 500,
  remaining: 499,
  periodStart: "2026-08-01T00:00:00.000Z",
  periodEnd: "2026-09-01T00:00:00.000Z",
  upgradeUrl: "",
};

/** Exactly what `route.ts › failOpen` answers. */
const DEGRADED = {
  ...CHARGED,
  wallet: null,
  used: 0,
  limit: 0,
  remaining: 0,
  upgradeUrl: "",
  degraded: true,
};

function build(opts: { sole: boolean } = { sole: true }) {
  registry.tools.clear();
  const directory = opts.sole ? [WS1] : [WS1, WS2];
  const client = {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: directory }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    consumeCredits: vi.fn().mockResolvedValue(CHARGED),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ ontologies: [], objects: {} }),
  } as unknown as DoplClient & { consumeCredits: ReturnType<typeof vi.fn> };
  createServer(client, {
    scopes: ["dopl.read", "dopl.write"],
    directory,
    workspace: opts.sole ? WS1 : null,
    role: opts.sole ? "owner" : null,
    workspaceSource: opts.sole ? "header pin" : null,
  });
  const map = registry.tools.get("dopl_map");
  if (!map) throw new Error("dopl_map was not registered");
  return { map, client };
}

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("");

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetUnmeteredLogForTests();
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("🔒 the footer says the call was not charged", () => {
  it("a DEGRADED answer proceeds and marks the call unmetered", async () => {
    const { map, client } = build();
    client.consumeCredits.mockResolvedValue(DEGRADED);

    const res = await map({});
    // ⚠ FAIL-OPEN IS UNCHANGED — this must never become a refusal.
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain("_dopl_status:");
    expect(text).toContain(NOTE_PREFIX);
    expect(text).toContain("answered without measuring anything");
  });

  it("a THROWN consume marks the call unmetered, with the other reason", async () => {
    const { map, client } = build();
    client.consumeCredits.mockRejectedValue(
      new Error('PGRST202: Could not find the function public.consume_user_credits'),
    );

    const text = textOf(await map({}));
    expect(text).toContain(NOTE_PREFIX);
    expect(text).toContain("did not answer");
  });

  it("a NORMAL charge leaves no note — the footer is otherwise unchanged", async () => {
    const { map } = build();
    const text = textOf(await map({}));
    expect(text).toContain("_dopl_status:");
    expect(text).not.toContain(NOTE_PREFIX);
    expect(error).not.toHaveBeenCalled();
  });

  it("rides the `workspace=` terminal path too — BOTH branches, not one", async () => {
    // ⚠ THE REGISTRAR HAS TWO `appendDoplStatus` CALL SITES and the charge is on
    // both, so a note wired into only one is a silence on half the traffic.
    // `dopl_map` HONOURS `workspace=` (`workspace-arg.ts › WORKSPACE_ARG_OPS`),
    // which is the branch this drives.
    const { map, client } = build({ sole: false });
    client.consumeCredits.mockResolvedValue(DEGRADED);

    const text = textOf(await map({ container: "beta" }));
    expect(text).toContain("workspace_source: per-call arg");
    expect(text).toContain(NOTE_PREFIX);
  });

  it("`joinNotes` keeps both facts about one call, in order, and drops neither", () => {
    // ⚠ THE OTHER NOTE IS THE IGNORED-`workspace=` ONE, which fires on an op
    // outside `WORKSPACE_ARG_OPS`. The two are independent facts about the same
    // call, so the footer carries both or it is lying by omission.
    expect(joinNotes("ignored: a", "unmetered: b")).toBe("ignored: a unmetered: b");
    expect(joinNotes(null, "unmetered: b")).toBe("unmetered: b");
    expect(joinNotes("ignored: a", null)).toBe("ignored: a");
    expect(joinNotes(null, undefined, "")).toBeNull();
  });
});

describe("🔒 the log fires ONCE per process per reason", () => {
  it("three degraded calls log once and mark all three", async () => {
    const { map, client } = build();
    client.consumeCredits.mockResolvedValue(DEGRADED);

    const texts = [await map({}), await map({}), await map({})].map(textOf);

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0] ?? "")).toContain("UNMETERED");
    // ⚠ THE NOTE IS PER CALL EVEN THOUGH THE LOG IS NOT — an agent that only
    // sees the second call must still learn that its call was free.
    for (const text of texts) expect(text).toContain(NOTE_PREFIX);
  });

  it("the two reasons are separate keys — one line each, not one line total", async () => {
    const { map, client } = build();
    client.consumeCredits.mockResolvedValue(DEGRADED);
    await map({});
    client.consumeCredits.mockRejectedValue(new Error("ECONNREFUSED"));
    await map({});
    await map({});

    expect(error).toHaveBeenCalledTimes(2);
    const lines = error.mock.calls.map((c) => String(c[0] ?? ""));
    expect(lines.some((l) => l.includes("answered DEGRADED"))).toBe(true);
    expect(lines.some((l) => l.includes("FAILED"))).toBe(true);
  });
});

describe("🔒 the note belongs to ONE call, not to the process", () => {
  it("two overlapping calls do not share a note", async () => {
    // ⚠ THE MUTATION THIS CASE EXISTS FOR: swap the `AsyncLocalStorage` for a
    // module-level "last reason" and the clean call below inherits the degraded
    // one's note — a footer telling an agent its charged call was free.
    const { map, client } = build();
    let nth = 0;
    client.consumeCredits.mockImplementation(async () => {
      const mine = ++nth;
      // Yield, so both calls are genuinely in flight across the await.
      await new Promise((r) => setTimeout(r, 0));
      return mine === 1 ? DEGRADED : CHARGED;
    });

    const [first, second] = await Promise.all([map({}), map({})]);

    expect(textOf(first)).toContain(NOTE_PREFIX);
    expect(textOf(second)).not.toContain(NOTE_PREFIX);
  });
});
