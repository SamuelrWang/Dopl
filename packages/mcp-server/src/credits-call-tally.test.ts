/**
 * Every charge carries the call it pays for — served tool, gate key, write class — so the consume
 * route can tally it (legacy-tool retirement counts these). Real `createServer`, real transport.
 */

import { it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import { createServer } from "./server.js";

it("tallies the tool, gate key and write class of each charged call", async () => {
  const ws = { id: "w1", name: "Alpha", slug: "alpha", role: "owner" } as WorkspaceListItem;
  const consumeCredits = vi.fn().mockResolvedValue({ allowed: true });
  const backend = {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [ws] }),
    getWorkspaceId: vi.fn(() => "w1"),
    setWorkspaceId: vi.fn(),
    consumeCredits,
  } as unknown as DoplClient;
  const server = createServer(backend, {
    directory: [ws],
    workspace: ws,
    role: "owner",
    workspaceSource: "header pin",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tally-probe", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  // Handlers fail on the stub backend; the charge, before them, is what is measured.
  for (const [name, args] of [
    ["dopl_map", {}],
    ["dopl_kb", { op: "list_bases" }],
    ["dopl_kb", { op: "create_base", name: "N" }],
    ["dopl_channel", { op: "rooms", action: "update", channel: "c" }],
    ["dopl_status", {}],
  ] as const) {
    await client.callTool({ name, arguments: args }).catch(() => undefined);
  }

  expect(consumeCredits.mock.calls).toEqual([
    ["w1", { tool: "dopl_map", op: "", write: false }],
    ["w1", { tool: "dopl_kb", op: "list_bases", write: false }],
    ["w1", { tool: "dopl_kb", op: "create_base", write: true }],
    ["w1", { tool: "dopl_channel", op: "rooms.update", write: true }],
    ["w1", { tool: "dopl_status", op: "", write: false }],
  ]);
});
