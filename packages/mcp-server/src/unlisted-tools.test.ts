/**
 * Spike A (DMP-013): a tool can be callable yet absent from `tools/list` on the SDK in use — and the
 * per-tool `_meta` Claude reads to keep a tool out of ToolSearch deferral reaches the listing
 * (spike B's server half). Measured through a real client over a real transport.
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

import { unlistTools } from "./unlisted-tools.js";
import { createServer } from "./server.js";
import { ALWAYS_LOAD_META } from "./tool-manifest.js";

async function connect(server: McpServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "unlisted-probe", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const text = (res: unknown) =>
  (res as { content: Array<{ text: string }> }).content.map((c) => c.text).join("");

describe("unlisted but callable", () => {
  it("drops the named tools from tools/list and still runs them", async () => {
    const server = new McpServer({ name: "probe", version: "0.0.0" });
    unlistTools(server, new Set(["hidden"]));
    const reply = (s: string) => async () => ({ content: [{ type: "text" as const, text: s }] });
    server.registerTool("shown", { inputSchema: { q: z.string().optional() } }, reply("shown ran"));
    server.registerTool("hidden", { inputSchema: { q: z.string().optional() } }, reply("hidden ran"));
    const client = await connect(server);

    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["shown"]);
    expect(text(await client.callTool({ name: "hidden", arguments: {} }))).toBe("hidden ran");
  });

  it("is wired into createServer, off unless named", async () => {
    const ws = { id: "w1", name: "Alpha", slug: "alpha", role: "owner" } as WorkspaceListItem;
    const backend = {
      listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [ws] }),
      getWorkspaceId: vi.fn(() => null),
      setWorkspaceId: vi.fn(),
    } as unknown as DoplClient;
    const boot = (unlistedTools?: ReadonlySet<string>) =>
      connect(createServer(backend, { directory: [ws], scopes: ["dopl.read"], unlistedTools }));

    const full = (await (await boot()).listTools()).tools.map((t) => t.name);
    const client = await boot(new Set(["dopl_workspaces"]));
    const listed = (await client.listTools()).tools.map((t) => t.name);

    expect(full).toContain("dopl_workspaces");
    expect(listed).toEqual(full.filter((n) => n !== "dopl_workspaces"));
    expect(text(await client.callTool({ name: "dopl_workspaces", arguments: {} }))).toContain("alpha");
  });
});

it("a tool's _meta reaches tools/list, where Claude reads per-tool alwaysLoad", async () => {
  const server = new McpServer({ name: "probe", version: "0.0.0" });
  server.registerTool("core", { _meta: ALWAYS_LOAD_META }, async () => ({ content: [] }));
  const client = await connect(server);
  expect((await client.listTools()).tools[0]._meta).toEqual({ "anthropic/alwaysLoad": true });
});
