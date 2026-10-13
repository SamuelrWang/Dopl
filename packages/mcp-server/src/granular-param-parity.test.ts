/**
 * **EVERY PARAM THE LEGACY TOOL PUBLISHES IS REACHABLE ON THE GRANULAR SET TOO**
 * (2026-10-12, grammar B's near-miss).
 *
 * ⚠ **THIS GATE EXISTS BECAUSE A FEATURE ALMOST SHIPPED INVISIBLE TO HALF THE
 * CLIENTS, AND NOTHING WOULD HAVE SAID SO.** `cites` was added to the legacy
 * `dopl_channel` shape, which publishes every param at once, so the work looked
 * done. A granular connection serves ~40 tools and each declares its own
 * allowlist in `tool-manifest.ts`; `cites` was in none of them. Every suite was
 * green. The only signal was an ASYMMETRY IN A BUDGET — the legacy surface moved
 * 6 chars and the granular one 650 — which is luck, not a gate: had the two
 * numbers happened to agree, a published, documented, forwarded field would have
 * been unreachable from the modern surface and no test would have mentioned it.
 *
 * ⚠ **MEASURED THROUGH A REAL `listTools()` ON BOTH SETS, NOT THROUGH THE
 * MANIFEST.** The manifest is exactly where such a drift lives, so reading it as
 * the source of truth would ask the suspect to vouch for itself. What a client is
 * handed is the only honest input.
 *
 * ⚠ **EXEMPTIONS ARE NAMED, WITH A REASON EACH.** A param that is legacy-only is
 * a legitimate design outcome — the granular set split the surface deliberately —
 * but it has to be ARGUED, once, where the next person reads it. An unnamed
 * absence is indistinguishable from the `cites` defect.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer } from "./server.js";
import type { ToolSet } from "./tool-manifest.js";

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

const propsOf = (tool: { inputSchema?: unknown }): string[] =>
  Object.keys(
    ((tool.inputSchema as { properties?: Record<string, unknown> })?.properties) ?? {},
  );

/**
 * **LEGACY PARAMS WITH NO GRANULAR HOME, EACH ARGUED.**
 *
 * ⚠ Adding a name here is a DECISION, not a fix. The question to answer first is
 * always "can an agent on the granular set do this at all?" — if yes by another
 * route, say which; if no, the entry is a feature gap wearing an exemption.
 */
const LEGACY_ONLY: Record<string, string> = {
  // The legacy tool is ONE tool with a verb selector; the granular set replaces that
  // selector with the tool NAMES themselves, which is the whole point of the split.
  // ⚠ **IT IS THE ONLY ENTRY, AND THE LIST STARTED WITH THREE.** I also exempted
  // `action` and `response_format` on the reasoning that they were legacy-wide
  // conventions — and the stale-exemption check below failed on both, because
  // granular tools DO declare them. Two unnecessary excuses, caught by the gate on
  // its own author before it was committed, which is the argument for that check
  // existing at all: an exemption is an assertion about the other surface, and mine
  // were wrong.
  op: "the legacy verb selector — the granular set replaces it with ~40 tool names",
};

let legacyParams: string[] = [];
const granularUnion = new Set<string>();
let legacyProbe: Client | undefined;
let granularProbe: Client | undefined;

beforeAll(async () => {
  legacyProbe = await connect("legacy");
  const legacy = (await legacyProbe.listTools()).tools.find((t) => t.name === "dopl_channel");
  if (!legacy) throw new Error("legacy connection served no dopl_channel");
  // `container` / `workspace` are injected by `registrar.ts` on EVERY tool of both
  // sets, so they are parity by construction and would only add noise.
  legacyParams = propsOf(legacy).filter((p) => p !== "container" && p !== "workspace");

  granularProbe = await connect("granular");
  for (const tool of (await granularProbe.listTools()).tools) {
    for (const p of propsOf(tool)) granularUnion.add(p);
  }
});

afterAll(async () => {
  await legacyProbe?.close();
  await granularProbe?.close();
});

describe("granular param parity", () => {
  it("🔒 both surfaces were really measured — a scan over nothing is not a guard", () => {
    expect(legacyParams.length).toBeGreaterThan(20);
    expect(granularUnion.size).toBeGreaterThan(20);
  });

  it("🔒 every legacy-published param is declared by at least one granular tool", () => {
    const missing = legacyParams
      .filter((p) => !granularUnion.has(p))
      .filter((p) => !(p in LEGACY_ONLY));
    expect(
      missing,
      `These params are published on the legacy \`dopl_channel\` and reachable from NO ` +
        `granular tool, so an agent on the modern surface cannot use them at all. This ` +
        `is the \`cites\` defect: add each to the owning tool's \`params\` in ` +
        `\`tool-manifest.ts\` (plus its one line in \`granular-text-channels.ts\`, which ` +
        `\`granular-text.test.ts\` requires), or add it to LEGACY_ONLY above WITH A REASON.`,
    ).toEqual([]);
  });

  it("🔒 every exemption is still a legacy param — a stale name hides the next gap", () => {
    // The other half of the ratchet. A name left here after it gained a granular
    // home, or after it left the legacy shape, silently excuses a future absence.
    const stale = Object.keys(LEGACY_ONLY).filter((p) => !legacyParams.includes(p));
    expect(
      stale,
      "no longer published on the legacy shape — delete the exemption",
    ).toEqual([]);
    const covered = Object.keys(LEGACY_ONLY).filter((p) => granularUnion.has(p));
    expect(
      covered,
      "now declared by a granular tool too — delete the exemption, it is no longer legacy-only",
    ).toEqual([]);
  });

  it("🔒 `cites` specifically is reachable on the granular set", () => {
    // Named, because it is the case that proved the gate was needed and the one a
    // future refactor of `dopl_send_message`'s param list would most plausibly drop.
    expect(granularUnion.has("cites")).toBe(true);
  });
});
