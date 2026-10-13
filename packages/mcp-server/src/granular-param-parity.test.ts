/**
 * **EVERY PARAM EVERY LEGACY TOOL PUBLISHES IS REACHABLE ON THE GRANULAR SET,
 * TOOL BY TOOL** (2026-10-12, grammar B's near-miss; widened by Review 39).
 *
 * ⚠ **THIS GATE EXISTS BECAUSE A FEATURE ALMOST SHIPPED INVISIBLE TO HALF THE
 * CLIENTS AND NOTHING WOULD HAVE SAID SO.** `cites` went onto the legacy
 * `dopl_channel` shape, which publishes every param at once, so the work looked
 * done. A granular connection serves 40 tools, each declaring its own allowlist in
 * `tool-manifest.ts`, and `cites` was in none of them. Every suite was green.
 *
 * ⚠ **AND THE ONE GATE THAT DID FIRE WOULD HAVE TALKED THE NEXT PERSON INTO
 * KEEPING THE BUG.** Measured: dropping `cites` from the manifest and the granular
 * text fails this file and `tool-budget.test.ts` — but the budget says *"the
 * granular served surface shrank below its ceiling — lower the ceiling to the
 * measured size in the same commit — that is how the win gets banked"*. It reports
 * a SAVING. Follow that instruction and the ceiling drops, the suite goes green,
 * and the unreachable param is blessed and permanent. A gate whose remediation
 * advice cements the defect is worse than no gate.
 *
 * ⚠ **PER TOOL, NOT AGAINST ONE POOLED UNION — REVIEW 39'S FINDING, AND IT IS
 * SHARP.** The first version of this file scanned `dopl_channel` alone, so a
 * legacy-only param planted on `dopl_kb` passed 4/4 green. A pooled union across
 * all 40 granular tools would still be too weak: `response_format` is declared by
 * several granular tools, so a pooled check calls it covered — while the tool bound
 * to `dopl_status` does not declare it, which means a granular agent genuinely
 * cannot shape that response. Coverage is therefore computed **per legacy tool**,
 * through the manifest's `bind` keys (`<legacy tool>:<op>`), and that strictness is
 * the only reason the `dopl_status` gap below is visible at all.
 *
 * ⚠ **PARAMS COME FROM A REAL `listTools()` ON BOTH SETS; ONLY THE MAPPING COMES
 * FROM THE MANIFEST.** The manifest is where a param-list drift lives, so it may
 * not vouch for its own param lists — but which legacy tool a granular tool
 * replaces is structure that exists nowhere else, and is not the thing that drifts.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer } from "./server.js";
import { GRANULAR_TOOLS, type ToolSet } from "./tool-manifest.js";

const WS: WorkspaceListItem = {
  id: "11111111-1111-1111-1111-111111111111", ownerId: "owner", name: "Alpha", slug: "alpha",
  publicId: "pub-1", description: null, role: "owner",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

function stubClient(): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [WS] }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    listChannels: vi.fn().mockResolvedValue([]),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ ontologies: [], objects: {} }),
  } as unknown as DoplClient;
}

async function connect(toolSet: ToolSet): Promise<Client> {
  const server = createServer(stubClient(), {
    toolSet,
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const probe = new Client({ name: "parity-probe", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), probe.connect(clientTransport)]);
  return probe;
}

/** `container` / `workspace` are injected on EVERY tool of both sets by `registrar.ts`. */
const INJECTED = new Set(["container", "workspace"]);

const propsOf = (tool: { inputSchema?: unknown }): string[] =>
  Object.keys(
    ((tool.inputSchema as { properties?: Record<string, unknown> })?.properties) ?? {},
  ).filter((p) => !INJECTED.has(p));

type GranularBind = string | Readonly<Record<string, string>>;

/** The legacy tool a binding key names: `<legacy tool>:<op>[.<action>]`. */
const legacyOf = (bind: GranularBind): string[] =>
  typeof bind === "string"
    ? [bind.split(":")[0]]
    : Object.values(bind).map((b) => String(b).split(":")[0]);

/**
 * **THE ELEVEN, BY NAME** (measured 2026-10-12). Named rather than counted so a
 * RENAME or a silently dropped tool fails here instead of quietly shrinking the
 * scan — the addendum's point: a count alone cannot tell eleven tools from eleven
 * copies of one.
 */
const LEGACY_TOOLS = [
  "dopl_agent", "dopl_channel", "dopl_chats", "dopl_kb", "dopl_map", "dopl_members",
  "dopl_ontology", "dopl_search", "dopl_skill", "dopl_status", "dopl_workspaces",
] as const;

/** Re-derived 2026-10-12 for the POOLED scan: 142 params over the eleven, 40 granular tools. */
const POOLED_PARAM_FLOOR = 135;
const GRANULAR_TOOL_FLOOR = 38;

/**
 * **LEGACY PARAMS WITH NO GRANULAR HOME — PER TOOL, EACH WITH ITS ROUTE OR ITS
 * FLAG.**
 *
 * ⚠ Every entry answers one question: **can a granular agent do this at all, and
 * by what route?** If it can, the route is named. If it cannot, the entry is a
 * FEATURE GAP wearing an exemption, and it says so in capitals so nobody reads
 * past it.
 *
 * ⚠ An earlier version of this list carried `action` and `response_format` as
 * blanket legacy-wide conventions. The stale check below failed on both, because
 * granular tools DO declare them — two unnecessary excuses, caught by the gate on
 * its own author. An exemption is an assertion about the other surface, and mine
 * were wrong.
 */
const LEGACY_ONLY: Record<string, Record<string, string>> = {
  // ⚠ ROUTE: the tool name IS the op. The legacy surface is one tool with a verb
  // selector; the granular set replaces that selector with 40 tool names, which is
  // the entire point of the split, so a granular agent loses nothing.
  dopl_agent: { op: "ROUTE: the granular tool name is the op (dopl_launch_agent, …)" },
  dopl_channel: { op: "ROUTE: the granular tool name is the op (dopl_send_message, …)" },
  dopl_chats: { op: "ROUTE: the granular tool name is the op (dopl_save_chat, …)" },
  dopl_kb: { op: "ROUTE: the granular tool name is the op (dopl_read_entry, …)" },
  dopl_members: { op: "ROUTE: the granular tool name is the op (dopl_list_members, …)" },
  dopl_ontology: { op: "ROUTE: the granular tool name is the op (dopl_browse_ontology, …)" },
  dopl_skill: { op: "ROUTE: the granular tool name is the op (dopl_get_skill, …)" },
  dopl_workspaces: { op: "ROUTE: the granular tool name is the op (dopl_list_workspaces, …)" },
  dopl_status: {
    // ⚠⚠ **NOT A ROUTE — A FEATURE GAP, FLAGGED (2026-10-12).** `status.ts:112` passes
    // `args.response_format` to `statusLines`, and the tool's own examples include
    // `{ response_format: "concise" }`, so the knob WORKS on the legacy surface. The
    // granular tool bound to `dopl_status` is `dopl_get_status`, declaring
    // `["since"]` only — so a granular agent cannot ask for a concise status and
    // always pays for the long one. No second granular tool binds `dopl_status`, so
    // there is no other route.
    // ⚠ Exempted ONLY to keep this gate green while the gap is decided, and
    // deliberately loud. The fix is one word in `tool-manifest.ts` plus its line in
    // `granular-text.ts` — but it costs pushed chars on every granular connection,
    // and that is a budget decision rather than a test's to make.
    response_format:
      "⚠ FEATURE GAP, NOT A ROUTE — dopl_get_status declares only `since`, so a " +
      "granular agent cannot shape the status response. Flagged, not accepted.",
  },
};

type Scan = { tool: string; params: string[]; covered: Set<string> };

let scans: Scan[] = [];
let granularCount = 0;
let legacyProbe: Client | undefined;
let granularProbe: Client | undefined;

beforeAll(async () => {
  legacyProbe = await connect("legacy");
  const legacyTools = (await legacyProbe.listTools()).tools;

  granularProbe = await connect("granular");
  const granularTools = (await granularProbe.listTools()).tools;
  granularCount = granularTools.length;
  const servedGranular = new Map(granularTools.map((t) => [t.name, propsOf(t)]));

  // Coverage per LEGACY tool, through the manifest's bind keys.
  const byLegacy = new Map<string, Set<string>>();
  for (const spec of GRANULAR_TOOLS) {
    const served = servedGranular.get(spec.name) ?? [];
    for (const legacy of legacyOf(spec.bind as GranularBind)) {
      const set = byLegacy.get(legacy) ?? new Set<string>();
      for (const p of served) set.add(p);
      byLegacy.set(legacy, set);
    }
  }

  scans = legacyTools.map((t) => ({
    tool: t.name,
    params: propsOf(t),
    covered: byLegacy.get(t.name) ?? new Set<string>(),
  }));
});

afterAll(async () => {
  await legacyProbe?.close();
  await granularProbe?.close();
});

describe("granular param parity, per legacy tool", () => {
  it("🔒 ALL ELEVEN legacy tools were scanned, by name — a skipped tool cannot pass", () => {
    expect([...scans.map((s) => s.tool)].sort()).toEqual([...LEGACY_TOOLS].sort());
  });

  it("🔒 the floors hold, so a collapsed scan cannot pass", () => {
    // Re-derived for the pooled scan; the old `> 20` was a one-tool floor and is
    // meaningless now.
    const pooled = scans.reduce((n, s) => n + s.params.length, 0);
    expect(pooled).toBeGreaterThanOrEqual(POOLED_PARAM_FLOOR);
    expect(granularCount).toBeGreaterThanOrEqual(GRANULAR_TOOL_FLOOR);
    // ⚠ `dopl_map` legitimately publishes ZERO params, so there is no per-tool floor
    // to assert — which is why the pooled floor and the by-name check above have to
    // carry that weight between them.
    expect(scans.filter((s) => s.params.length > 0).length).toBeGreaterThanOrEqual(9);
  });

  it("🔒 every legacy param is declared by a granular tool bound to THAT tool", () => {
    const missing = scans.flatMap((s) =>
      s.params
        .filter((p) => !s.covered.has(p))
        .filter((p) => !(p in (LEGACY_ONLY[s.tool] ?? {})))
        .map((p) => `${s.tool}.${p}`),
    );
    expect(
      missing,
      `Published on a legacy tool and reachable from NO granular tool bound to it, ` +
        `so a granular agent cannot use it. This is the \`cites\` defect. Add each to ` +
        `the owning tool's \`params\` in \`tool-manifest.ts\` (plus its line in the ` +
        `granular text, which \`granular-text.test.ts\` requires), or add it to ` +
        `LEGACY_ONLY WITH ITS ROUTE — and if there is no route, say FEATURE GAP.`,
    ).toEqual([]);
  });

  it("🔒 no exemption is stale — checked in BOTH directions, per entry", () => {
    const stale: string[] = [];
    for (const [tool, params] of Object.entries(LEGACY_ONLY)) {
      const scan = scans.find((s) => s.tool === tool);
      if (scan === undefined) {
        stale.push(`${tool}: exempts params on a tool that is no longer served`);
        continue;
      }
      for (const param of Object.keys(params)) {
        if (!scan.params.includes(param)) {
          stale.push(`${tool}.${param}: no longer published on that legacy tool`);
        }
        if (scan.covered.has(param)) {
          stale.push(`${tool}.${param}: NOW covered by a granular tool — delete the exemption`);
        }
      }
    }
    expect(
      stale,
      "a stale exemption silently excuses the next real gap — delete each line listed",
    ).toEqual([]);
  });

  it("🔒 `cites` specifically is reachable on the granular set", () => {
    // Named, because it is the case that proved this gate was needed and the most
    // plausible thing a future edit to `dopl_send_message`'s param list would drop.
    const channel = scans.find((s) => s.tool === "dopl_channel");
    expect(channel?.covered.has("cites")).toBe(true);
  });
});
