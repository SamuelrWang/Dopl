// `dopl_channel`'s input-schema budget, measured as served through a real `listTools()` (the SDK
// renders JSON Schema and the registrar injects args), beside the description budget in
// `tool-budget.test.ts`, which never reads the schema.

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer } from "../server.js";
import { channelDoctrine } from "./channel-doctrine.js";
import {
  CHANNEL_INPUT_SHAPE,
  PARAM_DESCRIPTION_MAX_CHARS,
  SCHEMA_MAX_CHARS,
} from "./channel-schema.js";
import { CHANNEL_OPS } from "./channel-vocab.js";

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

/** Enough of the client for registration; no handler runs on this path. */
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

let client: Client;
/** The served properties, minus the registrar's injected `container`/`workspace` args. */
let served: Record<string, unknown>;

beforeAll(async () => {
  const server = createServer(stubClient(), {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "schema-budget-probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const tool = (await client.listTools()).tools.find((t) => t.name === "dopl_channel");
  const properties = (tool?.inputSchema as { properties?: Record<string, unknown> })
    ?.properties;
  if (!properties) throw new Error("dopl_channel served no input schema");
  // `container`/`workspace` are injected by `registrar.ts`; counting them would move this number on
  // an edit in another file.
  served = Object.fromEntries(
    Object.entries(properties).filter(
      ([name]) => name !== "workspace" && name !== "container",
    ),
  );
});

afterAll(async () => {
  await client?.close();
});

describe("the served input schema fits its budget", () => {
  it("registers the shape at all (a scan over nothing is not a guard)", () => {
    expect(Object.keys(served).length).toBeGreaterThan(20);
    expect(served).toHaveProperty("op");
  });

  it(`is at most ${SCHEMA_MAX_CHARS} chars, injected \`container\`/\`workspace\` excluded`, () => {
    const size = JSON.stringify(served).length;
    expect(
      size,
      `the published shape grew to ${size}. Move the rule into channel-doctrine.ts › FIELDS, which is PULLED — do not raise the number`,
    ).toBeLessThanOrEqual(SCHEMA_MAX_CHARS);
  });

  it("the ratchet only ever moves DOWN — a shrunk schema must lower its ceiling", () => {
    // The other half of the ratchet: removed headroom must not be silently regained.
    const size = JSON.stringify(served).length;
    expect(
      size,
      `it shrank to ${size} — lower SCHEMA_MAX_CHARS to the measured size in the same commit`,
    ).toBeGreaterThan(SCHEMA_MAX_CHARS - 500);
  });

  it(`no single field's prose exceeds ${PARAM_DESCRIPTION_MAX_CHARS} chars`, () => {
    // One field's paragraph paid for by trimming nine others is the trade a total cannot catch.
    const over = Object.entries(served)
      .map(([name, schema]) => ({
        name,
        len: ((schema as { description?: string }).description ?? "").length,
      }))
      .filter(({ len }) => len > PARAM_DESCRIPTION_MAX_CHARS)
      .map(({ name, len }) => `${name}: ${len} chars`);
    expect(
      over,
      `a field's .describe() is carrying a rule again:\n- ${over.join("\n- ")}`,
    ).toEqual([]);
  });

  it("every declared field still names at least one op that takes it", () => {
    // The floor a shortened `.describe()` may never lose: which op takes this argument.
    // Any quoted op name counts; `CHANNEL_OPS` is the served set.
    const ops: readonly string[] = CHANNEL_OPS;
    const anonymous = Object.entries(served)
      .filter(([name]) => name !== "op")
      .filter(([, schema]) => {
        const prose = (schema as { description?: string }).description ?? "";
        return !ops.some((op) => prose.includes(`"${op}"`));
      })
      .map(([name]) => name);
    expect(anonymous, `these no longer name an op: ${anonymous.join(", ")}`).toEqual([]);
  });
});

describe("what the schema stopped carrying, the doctrine carries", () => {
  it("the FIELDS section exists and states each moved rule once", () => {
    // A move, not a delete: each line was once a paragraph inside a `.describe()`.
    expect(channelDoctrine()).toContain("THE ARGUMENTS THAT CARRY A RULE:");
    // Only rules with nowhere else to live belong here; one that fits its own `.describe()` stays there.
    for (const rule of [
      "OMITTING `channel` IS A WIDER READ",
      "ONE CURSOR SPACE, ONE `since`",
      "IN DOUBT, ADDRESS SOMEONE",
      "an artifact folds messages into ONE named card",
      "`client_msg_id` IS WHAT MAKES A RETRY SAFE",
      "`posture.chain` NAMES ITS THREE STATES",
    ])
      expect(channelDoctrine(), rule).toContain(rule);
    // And the other direction: neither may come back onto the pushed schema.
    const prose = Object.values(served)
      .map((schema) => (schema as { description?: string }).description ?? "")
      .join("\n");
    expect(prose).not.toContain("in doubt, address someone");
    expect(prose).not.toContain("folds messages into ONE named card");
  });

  it("and the shape declares every field those rules are about", () => {
    // A doctrine line about an argument that no longer exists teaches a phantom.
    for (const field of [
      "channel",
      "since",
      "kind",
      "artifact",
      "client_msg_id",
      "posture",
    ])
      expect(CHANNEL_INPUT_SHAPE, field).toHaveProperty(field);
  });
});
