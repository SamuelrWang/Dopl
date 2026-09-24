/**
 * The retired `dopl_ontology` names (`legacy-aliases.ts`) are REFUSED, and each refusal names its
 * successor. Real `createServer` over a real transport: the refusal is the SDK's parse step.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
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
let listed: Awaited<ReturnType<Client["listTools"]>>;
const createOntology = vi.fn();

beforeAll(async () => {
  const backend = {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [WS] }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    listChannels: vi.fn().mockResolvedValue([]),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ ontologies: [], objects: {} }),
    createOntology,
  } as unknown as DoplClient;
  const server = createServer(backend, {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "probe", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  listed = await client.listTools();
});

const text = (res: Awaited<ReturnType<Client["callTool"]>>) =>
  (res.content as Array<{ text: string }>).map((c) => c.text).join("");

describe("retired dopl_ontology names", () => {
  it("are absent from the served schema and description", () => {
    const tool = listed.tools.find((t) => t.name === "dopl_ontology");
    expect(tool).toBeDefined();
    expect(JSON.stringify(tool)).not.toMatch(/clust/i);
  });

  it("the old arg is refused, naming ontology", async () => {
    const res = await client.callTool({
      name: "dopl_ontology",
      arguments: { op: "map", cluster: "crm" },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("renamed: send ontology, not cluster");
  });

  it.each([
    ["create_cluster", "create_ontology"],
    ["update_cluster", "update_ontology"],
  ])("op=%s is refused, naming op=%s", async (old, successor) => {
    const res = await client.callTool({
      name: "dopl_ontology",
      arguments: { op: old, name: "CRM" },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain(`renamed: send op=${successor}`);
    expect(createOntology).not.toHaveBeenCalled();
  });
});
