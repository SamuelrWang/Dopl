/**
 * Every served tool's `title` is its own name. Codex copies a tool's `title` into its approval
 * request as `_meta.tool_title` — the request carries no other per-tool identity — and the desktop
 * refuses a Dopl approval it cannot name (`dopl-desktop-app/main/runtime/codex/server-requests.js ›
 * doplElicitation`). A tool served without it cannot be approved on Codex at all.
 *
 * Measured as served (real `createServer`, real transport), both registration paths included.
 */

import { it, expect, vi, beforeAll, afterAll } from "vitest";
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

let client: Client;

beforeAll(async () => {
  const backend = {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [WS] }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
  } as unknown as DoplClient;
  const server = createServer(backend, {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "title-probe", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
});

it("every tool, on both registration paths, is titled with its own name", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  // Both paths: `dopl_kb` is a domain tool, `dopl_status` / `dopl_workspaces` are meta tools.
  expect(names).toEqual(expect.arrayContaining(["dopl_channel", "dopl_kb", "dopl_status", "dopl_workspaces"]));
  const wrong = tools.filter((t) => t.title !== t.name).map((t) => `${t.name}: ${JSON.stringify(t.title)}`);
  expect(wrong, "Codex names an approval by `title`; these would be refused").toEqual([]);
});
