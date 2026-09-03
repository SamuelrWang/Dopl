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
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

import { createServer } from "./server.js";

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
});

afterAll(async () => {
  await client?.close();
});

describe("no served string names a retired copy or shelf", () => {
  it("serves something at all — a scan over nothing is not a guard", () => {
    // ⚠ THE FENCE THAT KEEPS THIS HONEST. If the probe stopped registering the
    // tools, every assertion below would pass over an empty list.
    expect(served.length).toBeGreaterThan(20);
    expect(served.some(([, body]) => body.length > 500)).toBe(true);
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
