/**
 * THE DOCTRINE IS REACHABLE — both doors, one text (T10, 2026-09-02).
 *
 * ⚠ WHY THIS SUITE EXISTS AT ALL. The efficiency tier's whole trade is that
 * ~14k characters of standing rules stopped being pushed into every description
 * and every write result, and became something an agent PULLS. That trade is
 * only sound while the pull actually works. A resource that fails to register,
 * or an `op="help"` that drifts from it, converts "stated once" into "stated
 * nowhere" — and nothing else in the suite would notice, because every other
 * test asserts what a result does NOT contain.
 *
 * ⚠ NOT MOCKED, DELIBERATELY. Every `McpServer` double in this package that
 * boots a real server stubs `registerResource` as a no-op (they assert over
 * TOOLS), so a mocked boot cannot observe registration at all — the failure
 * mode this file is for. ⚠ This said "the five doubles" and was measured at
 * EIGHT on 2026-09-02; re-derive rather than quote:
 * `grep -rln 'registerResource() {}' packages/mcp-server/src`.
 * It boots the real `createServer` over a real `InMemoryTransport` and asks a
 * real `Client`, the same shape `strict-args.test.ts` uses for the same reason.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer } from "./server.js";
import {
  CHANNEL_DOCTRINE,
  DOCTRINE_POINTER,
  DOCTRINE_URI,
} from "./tools/channel-doctrine.js";

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
    listChannels: vi.fn().mockResolvedValue([]),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ clusters: [], objects: {} }),
  } as unknown as DoplClient;
}

let client: Client;

beforeAll(async () => {
  const server = createServer(stubClient(), {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "doctrine-probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
});

afterAll(async () => {
  await client?.close();
});

describe("the channels doctrine is published as an MCP resource", () => {
  it("is listed at the URI every pointer names", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(
      uris,
      "the doctrine resource did not register — every description and result that points at it is now a dangling reference",
    ).toContain(DOCTRINE_URI);
  });

  it("reads back as the doctrine itself, as markdown", async () => {
    const { contents } = await client.readResource({ uri: DOCTRINE_URI });
    expect(contents).toHaveLength(1);
    expect(contents[0].mimeType).toBe("text/markdown");
    // ⚠ IDENTITY, NOT A SUBSTRING MATCH. A resource serving a summary of the
    // doctrine would pass a `toContain` and still be the drift this file exists
    // to prevent — the point of the tier is that there is ONE text.
    expect(contents[0].text).toBe(CHANNEL_DOCTRINE);
  });

  it("carries what left the descriptions and the results, so nothing was merely deleted", () => {
    // ⚠ ONE PROBE PER SURFACE THAT GAVE SOMETHING UP. If a future trim removes a
    // paragraph from a result AND forgets to land it here, the rule leaves the
    // product entirely — which is the one outcome this tier must not produce.
    const probes: Array<[string, string]> = [
      ["the law", "THE LAW OF THIS ROOM"],
      ["the loop brake", "THE LOOP BRAKE, AND IT IS ABSOLUTE"],
      ["main-room etiquette", "IF YOU HAVE ALREADY POSTED TO THIS CHANNEL IN THIS RUN"],
      ["the five zero-tag causes", "WHY A TAG RESOLVES TO NOBODY"],
      ["the await stop rule", "STOP and report to your operator"],
      ["the agent-handle limits", "THREE LIMITS"],
      ["the refusal words", "WHY A LAUNCH, END, DIRECTION OR RENAME IS REFUSED"],
      ["the session columns", 'READING "read_sessions"'],
      ["the home-channel rule", "A HOME CHANNEL is a room that lives in its own CONTAINER"],
    ];
    const missing = probes
      .filter(([, phrase]) => !CHANNEL_DOCTRINE.includes(phrase))
      .map(([what, phrase]) => `${what} (looked for: ${phrase})`);
    expect(
      missing,
      `these moved OUT of a description or a result and did not arrive in the doctrine:\n- ${missing.join("\n- ")}`,
    ).toEqual([]);
  });

  it("the pointer names BOTH doors — a client that cannot read resources still has one", () => {
    // ⚠ THE REASON `op="help"` EXISTS. Several MCP clients list tools and never
    // read resources; without the op, the rules would be unreachable for them.
    expect(DOCTRINE_POINTER).toContain(DOCTRINE_URI);
    expect(DOCTRINE_POINTER).toContain('op="help"');
  });

  it('`op="help"` returns the SAME text, byte for byte', async () => {
    const res = await client.callTool({
      name: "dopl_channel",
      arguments: { op: "help" },
    });
    const content = res.content as Array<{ type: string; text?: string }>;
    const text = content.map((c) => c.text ?? "").join("\n");
    // ⚠ `toContain`, not `toBe`: the registrar appends the mandatory
    // `_dopl_status` footer to every tool result (INVARIANTS §10), so the op's
    // payload is a prefix of what a client receives. The DOCTRINE half must be
    // identical — two doors, one text.
    expect(text).toContain(CHANNEL_DOCTRINE);
  });

  it('`op="help"` reads nothing — it makes no request at all', async () => {
    // ⚠ THIS IS WHY IT IS A READ OP IN `parity.test.ts › READ_OPS` rather than
    // merely "not a write": there is no client call in the handler to audit. A
    // future edit that gave it a lookup would need a security review, and this
    // is the assertion that forces one.
    const backend = stubClient();
    const server = createServer(backend, {
      directory: [WS],
      workspace: WS,
      role: "owner",
      workspaceSource: "sole membership",
      scopes: ["dopl.read", "dopl.write"],
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const probe = new Client({ name: "help-probe", version: "0.0.0" });
    await Promise.all([server.connect(st), probe.connect(ct)]);
    await probe.callTool({ name: "dopl_channel", arguments: { op: "help" } });
    expect(backend.listChannels).not.toHaveBeenCalled();
    await probe.close();
  });
});
