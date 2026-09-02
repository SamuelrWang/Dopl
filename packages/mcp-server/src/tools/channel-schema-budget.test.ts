/**
 * **THE INPUT-SCHEMA BUDGET FOR `dopl_channel`** — the gate that keeps the
 * doctrine out of the published shape (A6, 2026-09-02).
 *
 * ⚠ **WHY IT IS A SECOND BUDGET AND NOT A LINE IN THE FIRST ONE.** T82 capped
 * tool DESCRIPTIONS and `tool-budget.test.ts` has enforced that since. It reads
 * `t.description` and nothing else — so while `dopl_channel`'s description sat
 * on a 1,775-char ratchet, its input schema shipped **21,778 characters** on the
 * same connection, to the same clients, unmeasured. A budget with an unmeasured
 * neighbour is a budget prose walks around.
 *
 * ⚠ **AND WHY IT IS A DIFFERENT FILE.** `tool-budget.test.ts` is owned by the
 * budget-gates slice; every other slice asserts in its own new file, so the two
 * cannot collide on merge.
 *
 * ⚠ **MEASURED AS SERVED**, through a real `Client.listTools()` over a real
 * transport — the SDK renders the JSON Schema and the registrar injects a
 * `workspace` argument, so a shape measured at its source is not what an agent
 * receives. Same boot shape as `tool-budget.test.ts`, for the same reason.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer } from "../server.js";
import { CHANNEL_DOCTRINE } from "./channel-doctrine.js";
import {
  CHANNEL_INPUT_SHAPE,
  PARAM_DESCRIPTION_MAX_CHARS,
  SCHEMA_MAX_CHARS,
} from "./channel-schema.js";

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
/** The served properties, minus the registrar's injected `workspace` arg. */
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
  // ⚠ `workspace` is `registrar.ts`'s, injected into every domain tool. Counting
  // it would move this number on an edit made in another file by another slice.
  served = Object.fromEntries(
    Object.entries(properties).filter(([name]) => name !== "workspace"),
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

  it(`is at most ${SCHEMA_MAX_CHARS} chars, injected \`workspace\` excluded`, () => {
    const size = JSON.stringify(served).length;
    expect(
      size,
      `the published shape grew to ${size}. Move the rule into channel-doctrine.ts › FIELDS, which is PULLED — do not raise the number`,
    ).toBeLessThanOrEqual(SCHEMA_MAX_CHARS);
  });

  it("the ratchet only ever moves DOWN — a shrunk schema must lower its ceiling", () => {
    // ⚠ THE OTHER HALF OF A RATCHET, and the half `tool-budget.test.ts` shipped
    // asserting NOTHING until 2026-09-02: without it, headroom somebody spent
    // effort removing is silently regained by the next honest sentence.
    const size = JSON.stringify(served).length;
    expect(
      size,
      `it shrank to ${size} — lower SCHEMA_MAX_CHARS to the measured size in the same commit`,
    ).toBeGreaterThan(SCHEMA_MAX_CHARS - 500);
  });

  it(`no single field's prose exceeds ${PARAM_DESCRIPTION_MAX_CHARS} chars`, () => {
    // ⚠ THE HALF A TOTAL CANNOT ENFORCE: one field's paragraph paid for by
    // trimming nine others is exactly the trade this diet undid.
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
    // ⚠ A CAP ALONE WOULD BE SATISFIED BY DELETING THE CONTRACT. This is the
    // floor: the one thing a shortened `.describe()` may never lose is the
    // answer to "does this op want this argument". `op` itself is the
    // discriminator and names none.
    // ⚠ ANY QUOTED OP NAME COUNTS, not just the `op="x"` form — `channel` is
    // taken by all but three ops and lists the exceptions instead, which is
    // shorter AND the thing a caller needs.
    const ops = CHANNEL_INPUT_SHAPE.op.options;
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
    // ⚠ THE MOVE, ASSERTED AS A MOVE. Every line below was a paragraph inside a
    // `.describe()` on 2026-09-02. If a future trim deletes one instead of
    // relocating it, this fails — which a size cap on its own never could.
    expect(CHANNEL_DOCTRINE).toContain("THE ARGUMENTS THAT CARRY A RULE:");
    for (const rule of [
      "OMITTING `channel` IS A WIDER READ",
      "TWO CURSOR SPACES, ONE `since`",
      "`client_msg_id` DEDUPES OVER A DIFFERENT KEY ON EACH ROUTE",
      "`to` ON A PING IS NOT `to` ON A POST",
      "`handoff`=true ON \"create_thread\" HANDS THE EXCHANGE OVER",
      "`model` IS VALIDATED NOWHERE",
      "`chain` HAS THREE STATES, AND OMITTING IT IS NOT false",
      "`info_card` REPLACES THE WHOLE CARD",
      "`recommendation.index` MUST BE INSIDE `options`",
    ])
      expect(CHANNEL_DOCTRINE, rule).toContain(rule);
  });

  it("and the shape declares every field those rules are about", () => {
    // The pair: a doctrine line about an argument that no longer exists teaches
    // a phantom, which is the failure mode of moving prose out of its own file.
    for (const field of [
      "channel",
      "since",
      "client_msg_id",
      "to",
      "handoff",
      "model",
      "chain",
      "info_card",
      "recommendation",
    ])
      expect(CHANNEL_INPUT_SHAPE, field).toHaveProperty(field);
  });
});
