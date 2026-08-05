/**
 * F-145 — AN UNKNOWN TOOL ARGUMENT IS REFUSED BY NAME, NOT SILENTLY DROPPED.
 *
 * THE DEFECT THIS FILE PINS, end to end and through the REAL SDK. Every tool was
 * registered with a RAW SHAPE, which the SDK turns into a plain `z.object` and
 * parses with `safeParseAsync`. A plain `z.object` strips unknown keys, so
 * `dopl_channel {op:"post", body:"hi", to_agent:"quartz"}` was ACCEPTED,
 * `to_agent` never reached the handler, the post landed UNADDRESSED, and the
 * result narrated a success. That is the invisible delivery the route layer
 * already refuses — `src/features/channels/schema.ts#removedParam` declares the
 * deleted named-agent params as `z.never()` for exactly this reason — and the
 * MCP layer IN FRONT of it had the hole the route had closed. It was reachable:
 * `closedThreadNote` shipped a sentence teaching `to_agent="<handle>"` on every
 * post into a closed thread, so the tool taught the argument its own parser
 * then swallowed.
 *
 * NOT MOCKED, deliberately. `server.test.ts` stubs `McpServer` to capture
 * handlers, so it can pin what we PASS but never what the SDK DOES with it —
 * and the whole finding lives inside the SDK's parse step. This file boots the
 * real `createServer` over a real `InMemoryTransport` pair and asks a real
 * `Client`, so what it observes is what a remote agent observes.
 *
 * THE SCOPE IS EVERY TOOL, not `dopl_channel`. Removed vocabulary is one way a
 * model arrives at a param that does not exist; a stale cached tool list, an
 * older build's docs and plain invention are others, and none of them is
 * specific to channels.
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
    listClusters: vi.fn().mockResolvedValue({ clusters: [] }),
    listWorkflows: vi.fn().mockResolvedValue({ workflows: [] }),
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
    // The strictness is a NARROWING, not a rewrite: the params, their prose and
    // their caps are what they were, and `workspace` is still injected on every
    // tool. A schema that lost a field would also pass the test above.
    const channel = listed.tools.find((t) => t.name === "dopl_channel");
    const props = channel?.inputSchema?.properties as
      | Record<string, unknown>
      | undefined;
    expect(Object.keys(props ?? {})).toEqual(
      expect.arrayContaining(["op", "channel", "body", "to", "thread", "workspace"]),
    );
    expect(channel?.inputSchema?.required).toEqual(["op"]);
    // …and the removed params are not back as declared fields either.
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
    // The field is NAMED. That is the whole difference from a silent strip: a
    // calling agent can correct itself instead of believing a delivery that
    // never happened.
    expect(text).toContain("to_agent");
    expect(text).toContain("-32602");
    // AND the post did not happen. Before this change the call succeeded with
    // `to_agent` stripped and the result read "Posted to **General**".
    expect(posted).not.toHaveBeenCalled();
  });

  it("a legitimate call on the same op still goes through", async () => {
    // The refusal must be about the UNKNOWN key and nothing else — a strictness
    // change that also broke ordinary posts would be a worse bug than the one
    // it fixes.
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
