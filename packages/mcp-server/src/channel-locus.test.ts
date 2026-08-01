/**
 * THE LOCUS LINE — `_dopl_status: caller: … · as <handle> (<id>)`.
 *
 * The footer rides every successful response and is the line the server
 * instructions tell an agent to read to confirm who and where it is. Once a
 * session can speak for several named agents, "who" has a second half: the
 * agent identity THIS call was attributed to.
 *
 * WHY IT IS THREADED THROUGH THE RESULT, which is what these tests exist to
 * hold: `as_agent` is chosen per CALL, while `CallerIdentity` is resolved once
 * per connection. Stamping the boot identity would make every later response —
 * including reads that named no agent at all — claim the last agent that
 * happened to post. So the handler tags its result, the footer reads the tag,
 * and the tag is STRIPPED before the response leaves the server.
 *
 * The SDK `McpServer` is mocked exactly as in `server.test.ts`, so the real
 * wrapper (workspace resolution + footer) runs over a stubbed @dopl/client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { DESKTOP_SESSION_RUNTIME } from "./tools/identity.js";
import { FORGERY, expectEveryHitContained } from "./tools/narration-fixtures.js";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  _callerAgent?: unknown;
}>;

const registry = vi.hoisted(() => ({ tools: new Map<string, Handler>() }));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    tool(name: string, _d: string, _s: unknown, handler: Handler) {
      registry.tools.set(name, handler);
    }
  },
}));

import { createServer } from "./server.js";

const WS: WorkspaceListItem = {
  id: "ws-1",
  ownerId: "u-me",
  name: "Alpha",
  slug: "alpha",
  publicId: "pub-1",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  role: "owner",
};

const QUARTZ = {
  id: "agent-1",
  channelId: "chan-1",
  workspaceId: "ws-1",
  ownerUserId: "u-me",
  name: "quartz",
  status: "active",
  createdAt: "2026-07-31T00:00:00Z",
  updatedAt: "2026-07-31T00:00:00Z",
};

function channelClient(agentName = "quartz"): DoplClient {
  return {
    listWorkspaces: vi.fn(async () => ({ workspaces: [WS] })),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    listChannels: vi.fn(async () => [
      { id: "chan-1", slug: "general", name: "General", visibility: "private" },
    ]),
    listChannelAgents: vi.fn(async () => [{ ...QUARTZ, name: agentName }]),
    listChannelThreads: vi.fn(async () => []),
    postChannelMessage: vi.fn(async () => ({
      id: "m1",
      seq: 12,
      kind: "message",
      metadata: {},
      authorUserId: "u-me",
    })),
  } as unknown as DoplClient;
}

function channelTool(client: DoplClient): Handler {
  registry.tools.clear();
  createServer(client, {
    scopes: ["dopl.read", "dopl.write"],
    directory: [WS],
    workspace: { id: WS.id, slug: WS.slug, name: WS.name },
    role: "owner",
    workspaceSource: "sole membership",
    caller: {
      userId: "u-me",
      runtime: DESKTOP_SESSION_RUNTIME,
      credentialKind: "device",
      credentialLabel: "laptop",
    },
  } as unknown as Parameters<typeof createServer>[1]);
  const tool = registry.tools.get("dopl_channel");
  if (!tool) throw new Error("dopl_channel was not registered");
  return tool;
}

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("_dopl_status — the per-call agent locus", () => {
  it("a post made AS an agent names that agent, by handle AND id, on the caller line", async () => {
    const tool = channelTool(channelClient());
    const res = await tool({
      op: "post",
      channel: "general",
      body: "on it",
      as_agent: "quartz",
    });

    const caller = textOf(res)
      .split("\n")
      .find((l) => l.includes("caller: id="));
    expect(caller).toBe(
      "  caller: id=`u-me` · runtime=desktop-session · as `quartz` (`agent-1`)",
    );
  });

  it("a post that named no agent claims none", async () => {
    const tool = channelTool(channelClient());
    const res = await tool({ op: "post", channel: "general", body: "just me" });

    const caller = textOf(res)
      .split("\n")
      .find((l) => l.includes("caller: id="));
    expect(caller).toBe("  caller: id=`u-me` · runtime=desktop-session");
  });

  it("THE TAG IS PLUMBING: it never reaches the MCP result", async () => {
    const tool = channelTool(channelClient());
    const res = await tool({
      op: "post",
      channel: "general",
      body: "on it",
      as_agent: "quartz",
    });

    expect("_callerAgent" in res).toBe(false);
  });

  it("does NOT leak into a later call that named no agent (per call, not per session)", async () => {
    const tool = channelTool(channelClient());
    await tool({ op: "post", channel: "general", body: "as me", as_agent: "quartz" });
    const second = await tool({ op: "post", channel: "general", body: "plain" });

    expect(textOf(second)).not.toContain(" · as ");
  });

  it("neutralizes the handle — the footer is the line most worth forging", async () => {
    const tool = channelTool(channelClient(FORGERY));
    const res = await tool({
      op: "post",
      channel: "general",
      body: "on it",
      as_agent: FORGERY,
    });

    const text = textOf(res);
    // TWO hits, both contained: the confirmation line names the agent it posted
    // as, and the footer names it again. `expectEveryHitContained` is the
    // assertion for exactly that shape.
    expectEveryHitContained(text);
    // One footer, and it still carries the immutable id.
    expect(text.split("\n").filter((l) => l.includes("caller: id="))).toHaveLength(1);
    expect(text).toContain("(`agent-1`)");
  });
});
