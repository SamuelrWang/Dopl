/**
 * 🔒 **THE COPY AND SHELF VOCABULARY IS OFF THE SERVED SURFACE, AND STAYS OFF**
 * (2026-09-02, wave B slice B15, Samuel's rulings B10 + B11).
 *
 * The copy ops and the shelf argument were deleted from `dopl_kb` and
 * `dopl_agent`, and `home_scoped` was dropped from both tables. ⚠ **A DELETED
 * MECHANISM WHOSE WORD SURVIVES IN A DESCRIPTION IS WORSE THAN ONE THAT NEVER
 * SHIPPED**: an agent reads the word, spends a call on the argument, and gets a
 * `-32602` naming a field the surface no longer has — or, on `shelf`, gets a
 * SILENT ANSWER over a scope nobody applied. The retired copy names PARSE for
 * one release and are answered with a redirect (`tools/retired-copy-ops.ts`),
 * which is the opposite of appearing in a description: they are reachable and
 * invisible on purpose.
 *
 * ⚠ **MEASURED AS SERVED, over a real `listTools()` on a real transport**, for
 * the reason `tool-budget.test.ts` and `agent-team-axis.test.ts` both give: the
 * registrar injects arguments and the SDK renders the JSON Schema, so a constant
 * read at its source is not the string an agent receives. Descriptions, INPUT
 * SCHEMAS (every `.describe()`), the `instructions` briefing and every PULLED
 * resource are all scanned — the schemas are where doctrine goes when a
 * description gets audited, and the doctrine is where it goes after that.
 *
 * ⚠ **THE SCAN IS NOT THE SAME QUESTION AS `law-scan.test.ts`'s.** That one asks
 * whether a `channel-*.ts` SOURCE FILE contains a banned string; this asks what
 * an external connection actually receives, across all eleven tools. A word can
 * pass one and fail the other, and both directions have happened.
 *
 * 🔒 ⚠ **AND `listTools()` IS NOT THE WHOLE SURFACE — THAT GAP LET FOUR STALE
 * ROUTES SHIP** (fixed 2026-09-02 in review). A description and a schema are
 * what an agent reads BEFORE it calls; a REFUSAL is what it reads at the one
 * moment it is looking for the next thing to try, which is when a dead route
 * costs the most. Nothing here saw them, because they are neither served at
 * connect time nor published as a resource: `channel-doctrine.ts › TENANCY_FIX`
 * still routed a refused launch at `dopl_agent op="copy", to_workspace` (B15
 * deleted both), `TENANCY_RULE` still said "personal shelf", and the grant
 * scope refusal sent a caller to `dopl_home(op="list_channels")` and
 * `list_workspaces` (B13 deleted both TOOLS). So the scan takes three sources
 * now, not one:
 *
 *   1. what `listTools()` / `instructions` / the published RESOURCES carry;
 *   2. every exported STRING of the doctrine module — the refusal prose that is
 *      pulled on demand or spliced into a result, never served;
 *   3. results DRIVEN out of the renderers that build them, because a template
 *      literal only becomes a sentence when something calls it.
 *
 * ⚠ **`tools/retired-copy-ops.ts` IS DELIBERATELY NOT A SOURCE.** Its whole job
 * is to NAME a retired op back to the caller that tried it; scanning it would
 * fail the suite on the one file that is supposed to say those words.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

import { createServer } from "./server.js";
// SOURCE 2 — the doctrine/refusal prose, as a namespace so a constant added to
// that module joins this scan without anyone remembering to list it.
import * as doctrine from "./tools/channel-doctrine.js";
// SOURCE 3 — the renderers. ⚠ Driven, not read: these are template literals.
import { grantedLine, resolveGrantScopeId } from "./tools/grant.js";
import type { WorkspaceDirectory } from "./workspace-directory.js";

const WS: WorkspaceListItem = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerId: "owner",
  name: "Alpha",
  slug: "alpha",
  publicId: "pub-1",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  role: "owner",
};

/**
 * The retired words, and each one's reason. ⚠ **`copy` ALONE IS NOT BANNED** and
 * must not be: it is an ordinary English verb this surface uses legitimately
 * ("a copy of", "copied into the prompt"). What is banned is the OP NAME and the
 * ARGUMENT that only the copy ops took — the strings an agent would try to call.
 */
const RETIRED: ReadonlyArray<[string, RegExp]> = [
  ["the copy ops", /\bcopy_base\b|op="copy"|op='copy'|\bop=copy\b/],
  ["the copy ops' target argument", /\bto_workspace\b/],
  ["the shelf argument", /\bshelf\b/i],
  ["the dropped column", /home_scoped|homeScoped/],
  // ⚠ **THE THREE DELETED TOOLS (B13), AND A TOOL NAME IS THE WORST KIND OF
  // STALE ROUTE**: an argument that no longer parses answers `-32602` and the
  // agent learns something; a tool that no longer EXISTS answers "unknown
  // tool", which reads as a broken connection rather than as a retirement.
  // Their successor is `dopl_workspaces`.
  [
    "a retired orientation tool",
    /\bdopl_home\b|\blist_workspaces\b|\bcurrent_workspace\b/,
  ],
  // …and the ops those tools carried. Banned separately because a SURVIVING
  // tool can name one: the grant refusal routed at `op="list_channels"` for a
  // release after the tool holding it was deleted.
  ["a retired orientation op", /\blist_channels\b|\bcreate_channel\b/],
];

/** Enough of the client for registration. ⚠ No handler runs on this path. */
function stubClient(): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [WS] }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    listChannels: vi.fn().mockResolvedValue([]),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ clusters: [], objects: {} }),
  } as unknown as DoplClient;
}

let client: Client;
/** Every string an external connection receives, labelled by where it came from. */
let served: Array<[string, string]>;

beforeAll(async () => {
  const server = createServer(stubClient(), {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "retired-vocab-probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const listed = await client.listTools();
  served = [
    ["instructions", client.getInstructions() ?? ""],
    ...listed.tools.flatMap(
      (t): Array<[string, string]> => [
        [`${t.name}.description`, t.description ?? ""],
        // ⚠ THE BIGGER HALF, and the one a description audit pushes words INTO.
        [`${t.name}.inputSchema`, JSON.stringify(t.inputSchema)],
      ],
    ),
  ];
  const published = await client.listResources();
  for (const { uri } of published.resources) {
    const read = await client.readResource({ uri });
    served.push([
      uri,
      read.contents.map((c) => ("text" in c ? c.text : "")).join(""),
    ]);
  }

  // ── SOURCE 2: the doctrine module's prose, whether or not it is published ──
  for (const [name, value] of Object.entries(doctrine)) {
    if (typeof value === "string") served.push([`channel-doctrine.${name}`, value]);
  }

  // ── SOURCE 3: results driven out of the renderers that build them ─────────
  for (const [where, body] of await renderedResults()) served.push([where, body]);
});

/**
 * The RESULT strings a caller only sees by making the call. ⚠ Each one is
 * driven through its real renderer rather than imported: they are template
 * literals, so a constant read at its source is not the sentence an agent gets
 * — the same reason this file measures `listTools()` over a transport.
 *
 * ⚠ **THE REFUSALS ARE THE POINT.** A caller reads a refusal at the one moment
 * it is choosing what to try next, so a dead route named there costs a call and
 * an inference about the connection. Add a renderer here whenever one starts
 * naming another tool.
 */
async function renderedResults(): Promise<Array<[string, string]>> {
  const text = (r: { content: Array<{ type: string; text?: string }> }) =>
    r.content.map((c) => c.text ?? "").join("\n");
  // A directory that resolves NOTHING — the refusal branch, which is the one
  // that has to tell the caller where a container id comes from.
  const noDirectory = {
    resolveWorkspaceRef: async () => null,
  } as unknown as WorkspaceDirectory;
  const refusal = await resolveGrantScopeId(noDirectory, "container", "nope");
  return [
    [
      "grant.resolveGrantScopeId (unresolvable container)",
      typeof refusal === "string" ? refusal : text(refusal),
    ],
    [
      "grant.grantedLine",
      text(grantedLine("knowledge base", "Notes", "container", "ws-1", "read")),
    ],
  ];
}

afterAll(async () => {
  await client?.close();
});

describe("no served string names a retired copy or shelf", () => {
  it("serves something at all — a scan over nothing is not a guard", () => {
    // ⚠ THE FENCE THAT KEEPS THIS HONEST. If the probe stopped registering the
    // tools, every assertion below would pass over an empty list.
    expect(served.length).toBeGreaterThan(20);
    expect(served.some(([, body]) => body.length > 500)).toBe(true);
    // …and the same fence over each ADDED source, because a namespace import
    // that stopped exporting strings, or a renderer that started throwing,
    // would otherwise widen the scan back to `listTools()` silently.
    for (const prefix of ["channel-doctrine.", "grant."]) {
      expect(
        served.filter(([where]) => where.startsWith(prefix)).length,
        prefix,
      ).toBeGreaterThan(1);
    }
  });

  for (const [what, pattern] of RETIRED) {
    it(`does not name ${what}`, () => {
      const offenders = served
        .filter(([, body]) => pattern.test(body))
        .map(([where]) => where);
      expect(
        offenders,
        `these SERVED strings still name ${what} — the mechanism is deleted, so the word sends a caller to spend a call on a field this surface does not have:\n- ${offenders.join("\n- ")}`,
      ).toEqual([]);
    });
  }

  it("🔒 but the retired OP NAMES still parse, which is the opposite property", () => {
    // ⚠ ASSERTED HERE, beside the ban, because the two are one decision and a
    // reader who sees only the ban will conclude the names were removed from the
    // runtime too. They are hidden from the PUBLISHED enum and answered with one
    // redirect line; `tools/retired-copy-ops.test.ts` drives both halves.
    const names = served
      .filter(([where]) => where.endsWith(".inputSchema"))
      .map(([, body]) => body);
    expect(names.some((s) => s.includes("copy_base"))).toBe(false);
    expect(names.some((s) => s.includes('"grant"'))).toBe(true);
  });
});
