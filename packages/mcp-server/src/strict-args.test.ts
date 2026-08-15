/**
 * ⚠ AN UNKNOWN TOOL ARGUMENT IS REFUSED BY NAME, NOT SILENTLY DROPPED. A raw
 * shape becomes a plain `z.object`, which STRIPS unknown keys: an invented
 * addressing param is accepted, never reaches the handler, the post lands
 * UNADDRESSED, and the result narrates a success — the invisible delivery the
 * route layer already refuses with `z.never()` params.
 *
 * ⚠ NOT MOCKED: the finding lives inside the SDK's parse step, which a stubbed
 * `McpServer` cannot observe. Boots the real `createServer` over a real
 * `InMemoryTransport` pair and asks a real `Client`.
 *
 * ⚠ SCOPE IS EVERY TOOL. Removed vocabulary is one way a model arrives at a
 * param that does not exist; a stale cached tool list, an older build's docs
 * and plain invention are others.
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

/** Enough of the client for registration + the one op we actually call. */
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
let listed: Awaited<ReturnType<Client["listTools"]>>;
let posted: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const backend = stubClient();
  posted = vi.fn(async () => ({
    id: "m1",
    seq: 7,
    kind: "message",
    authorUserId: "u-me",
    metadata: {},
  }));
  (backend as unknown as { postChannelMessage: unknown }).postChannelMessage =
    posted;
  (backend as unknown as { listChannels: unknown }).listChannels = vi.fn(
    async () => [{ id: "chan-1", name: "General", slug: "general" }],
  );
  const server = createServer(backend, {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  client = new Client({ name: "probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  listed = await client.listTools();
});

afterAll(async () => {
  await client?.close();
});

describe("the published input schema forbids extra properties", () => {
  it("registers the tools at all (a scan over nothing is not a guard)", () => {
    expect(listed.tools.length).toBeGreaterThan(5);
    expect(listed.tools.map((t) => t.name)).toContain("dopl_channel");
  });

  it("EVERY tool publishes additionalProperties:false", () => {
    const loose = listed.tools
      .filter((t) => t.inputSchema?.additionalProperties !== false)
      .map((t) => t.name);
    expect(
      loose,
      `these tools still accept-and-drop unknown arguments: ${loose.join(", ")}`,
    ).toEqual([]);
  });

  it("…and nothing else about the published schema changed", () => {
    // ⚠ Strictness is a NARROWING, not a rewrite — params, prose and caps are
    // unchanged and `workspace` is still injected. A schema that LOST a field
    // would also pass the test above.
    const channel = listed.tools.find((t) => t.name === "dopl_channel");
    const props = channel?.inputSchema?.properties as
      | Record<string, unknown>
      | undefined;
    expect(Object.keys(props ?? {})).toEqual(
      expect.arrayContaining(["op", "channel", "body", "to", "thread", "workspace"]),
    );
    expect(channel?.inputSchema?.required).toEqual(["op"]);
    for (const gone of ["to_agent", "to_agents", "as_agent", "participants"]) {
      expect(Object.keys(props ?? {})).not.toContain(gone);
    }
  });
});

describe("a removed param is REFUSED, and the refusal names the field", () => {
  it("dopl_channel op=post + to_agent → -32602 naming to_agent, and NOTHING is posted", async () => {
    const res = await client.callTool({
      name: "dopl_channel",
      arguments: { op: "post", channel: "general", body: "hi", to_agent: "quartz" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ text: string }>)
      .map((c) => c.text)
      .join("");
    // ⚠ The field is NAMED — the whole difference from a silent strip, since a
    // calling agent can then correct itself.
    expect(text).toContain("to_agent");
    expect(text).toContain("-32602");
    // ⚠ AND the post did not happen.
    expect(posted).not.toHaveBeenCalled();
  });

  it("a legitimate call on the same op still goes through", async () => {
    // ⚠ The refusal must be about the UNKNOWN key and nothing else.
    const res = await client.callTool({
      name: "dopl_channel",
      arguments: { op: "post", channel: "general", body: "hi" },
    });
    expect(res.isError).toBeFalsy();
    expect(posted).toHaveBeenCalledTimes(1);
  });

  it("an INVENTED param is refused on the same rule (this is not a denylist)", async () => {
    const res = await client.callTool({
      name: "dopl_channel",
      arguments: { op: "read", channel: "general", urgency: "high" },
    });
    expect(res.isError).toBe(true);
    expect(
      (res.content as Array<{ text: string }>).map((c) => c.text).join(""),
    ).toContain("urgency");
  });
});
