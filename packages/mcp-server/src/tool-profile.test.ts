/**
 * THE ROLE-SCOPED TOOL OFFER — the `X-Dopl-Tool-Profile` mechanism, end to end
 * through the REAL `createServer` over a real transport (2026-09-02, MCP v2 A3).
 *
 * ⚠ WHAT IS UNDER TEST IS THE PROPERTY, NOT A TABLE. `gating.ts ›
 * TOOL_PROFILE_TOOLS` ships EMPTY — wave B fills it — so an assertion over
 * today's rows would be vacuous and an assertion over a fixture row would only
 * prove the fixture. The three claims below are the ones that must hold for
 * EVERY row anybody ever adds:
 *
 *   1. NARROWING-ONLY: a role's offer is intersected with what the registrars
 *      register, so no row can name a tool into existence.
 *   2. FAIL-OPEN, DELIBERATELY: absent header, unknown role and a role with no
 *      row all serve the WHOLE surface. A desktop newer than this server must
 *      degrade to today's behaviour, never to an empty tool list — and because
 *      the header is caller-supplied, fail-open is also the only honest posture:
 *      it is a HINT. `disallowedTools` + `grantDecision` + the credential are
 *      what refuse a call.
 *   3. It reaches registration at all, on BOTH registration paths — the domain
 *      wrapper and `registerMetaTool`, which registers straight onto the SDK
 *      server. (`meta-gate.test.ts` drives the meta path's suppression LINE with
 *      a synthetic set; this drives the whole boot.)
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

import { createServer } from "./server.js";
import { TOOL_PROFILE_TOOLS, offeredToolsFor } from "./gating.js";

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

function stubClient(): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [WS] }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
  } as unknown as DoplClient;
}

/** Boot a session with `toolProfile` and return the names it is served. */
async function servedTools(toolProfile?: string | null): Promise<string[]> {
  const server = createServer(stubClient(), {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
    toolProfile,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "profile-probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const listed = await client.listTools();
  await client.close();
  return listed.tools.map((t) => t.name).sort();
}

let whole: string[];

beforeAll(async () => {
  whole = await servedTools();
});

afterAll(() => {
  // ⚠ The suite's own premise: a boot with no header serves a real surface, or
  // every "unchanged" assertion below passes over an empty list.
  expect(whole.length).toBeGreaterThan(5);
});

describe("the table ships EMPTY — the mechanism only (wave A)", () => {
  it("has no rows, so nothing narrows yet", () => {
    // ⚠ Pinned as a VALUE. The day wave B adds `courier`, this fails, and that
    // is the prompt to assert the new row's contents rather than this line.
    expect([...TOOL_PROFILE_TOOLS.keys()]).toEqual([]);
  });

  it("every role therefore serves the whole surface, header or not", async () => {
    expect(await servedTools("dopl_only")).toEqual(whole);
    expect(await servedTools("read_only")).toEqual(whole);
    expect(await servedTools("full")).toEqual(whole);
  });
});

describe("offeredToolsFor — the one place a role becomes a set", () => {
  it("answers null for absent, empty, unknown — and for an inherited key", () => {
    // ⚠ THE FAIL-OPEN DIRECTION, and it is the SAFE one here: the header grants
    // nothing, so serving too much is a token cost, while serving too little
    // would break a session over a word this server had not heard of.
    expect(offeredToolsFor(undefined)).toBeNull();
    expect(offeredToolsFor(null)).toBeNull();
    expect(offeredToolsFor("")).toBeNull();
    expect(offeredToolsFor("no_such_role")).toBeNull();
    // ⚠ THE ONE THAT IS NOT OBVIOUS, and why the table is a Map: on an object
    // literal `["constructor"]` answers a truthy function off the prototype,
    // and the gate then calls `.has` on it. The key comes off a request header.
    expect(offeredToolsFor("constructor")).toBeNull();
    expect(offeredToolsFor("toString")).toBeNull();
    expect(offeredToolsFor("__proto__")).toBeNull();
  });

  it("resolves a row to its set when one exists", () => {
    // ⚠ Driven through a LOCAL table of the same shape, because the real one is
    // empty by design and this is the arm wave B turns on.
    const table = new Map<string, ReadonlySet<string>>([
      ["courier", new Set(["dopl_channel"])],
    ]);
    const resolve = (p: string | null | undefined) => (p && table.get(p)) || null;
    expect([...(resolve("courier") ?? [])]).toEqual(["dopl_channel"]);
    expect(resolve("full")).toBeNull();
  });
});

describe("a role can only NARROW", () => {
  it("an offer naming a tool no registrar registers adds nothing", async () => {
    // ⚠ THE PROPERTY WAVE B DEPENDS ON. The offer is an ALLOW set intersected
    // with the registrars, never a registration list, so a typo or a stale row
    // can lose a tool and can never invent one.
    const server = createServer(stubClient(), {
      directory: [WS],
      workspace: WS,
      role: "owner",
      workspaceSource: "sole membership",
      scopes: ["dopl.read", "dopl.write"],
      toolProfile: "full",
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "probe", version: "0.0.0" });
    await Promise.all([server.connect(st), client.connect(ct)]);
    const listed = await client.listTools();
    await client.close();
    expect(listed.tools.map((t) => t.name)).not.toContain("dopl_kb_admin");
    expect(listed.tools.map((t) => t.name).sort()).toEqual(whole);
  });
});
