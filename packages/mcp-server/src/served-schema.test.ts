/**
 * Context Economy W1: the LISTED schema drops zod converter artifacts and publishes three posture
 * levels, while the handler still validates exactly as before. Measured through a real client over
 * a real transport, on a bare server and on the shipped granular surface.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DoplClient } from "@dopl/client";

import { slimListedSchemas } from "./served-schema.js";
import { createServer } from "./server.js";
import { CHANNEL_INPUT_SHAPE } from "./tools/channel-schema.js";
import { GRANULAR_POSTURE_FIELD } from "./tools/channel-schema-launch-fields.js";

async function connect(server: McpServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "served-schema-probe", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const UUID = "11111111-1111-4111-8111-111111111111";

describe("slimListedSchemas on a bare server", () => {
  async function probe() {
    const server = new McpServer({ name: "probe", version: "0.0.0" });
    slimListedSchemas(server);
    server.registerTool(
      "t",
      { inputSchema: { id: z.string().uuid(), n: z.number().int().min(0), m: z.number().int(), slug: z.string().regex(/^[a-z]+$/) } },
      async () => ({ content: [{ type: "text" as const, text: "ran" }] }),
    );
    return connect(server);
  }

  it("lists uuid as a format with no regex, and no MAX_SAFE_INTEGER bounds", async () => {
    const client = await probe();
    const props = (await client.listTools()).tools[0].inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.id).toEqual({ type: "string", format: "uuid" });
    expect(props.n).toEqual({ type: "integer", minimum: 0 });
    expect(props.m).toEqual({ type: "integer" });
    // A regex that is NOT a uuid artifact is a real rule and stays.
    expect(props.slug.pattern).toBe("^[a-z]+$");
    expect((await client.listTools()).tools[0].inputSchema).not.toHaveProperty("$schema");
  });

  it("still refuses a malformed uuid and accepts a real one: validation is the zod schema, not the listing", async () => {
    const client = await probe();
    const bad = await client.callTool({ name: "t", arguments: { id: "not-a-uuid", n: 0, m: 1, slug: "a" } });
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.content)).toMatch(/uuid/i);
    const good = await client.callTool({ name: "t", arguments: { id: UUID, n: 0, m: 1, slug: "a" } });
    expect(good.isError).toBeFalsy();
  });
});

describe("the shipped granular surface", () => {
  const WS = {
    id: "11111111-1111-1111-1111-111111111111", ownerId: "owner", name: "Alpha", slug: "alpha",
    publicId: "pub-1", description: null, role: "owner" as const, createdAt: "x", updatedAt: "x",
  };
  async function granularTools() {
    const r = (v: unknown) => async () => v;
    const stub = {
      listWorkspaces: r({ workspaces: [WS] }), getWorkspaceId: () => null, setWorkspaceId: () => {},
      listChannels: r([]), listKbBases: r([]), listSkills: r([]), getOntology: r({ ontologies: [], objects: {} }),
    } as unknown as DoplClient;
    const server = createServer(stub, {
      toolSet: "granular", directory: [WS], workspace: WS, role: "owner",
      workspaceSource: "sole membership", scopes: ["dopl.read", "dopl.write"],
    } as Parameters<typeof createServer>[1]);
    return (await (await connect(server)).listTools()).tools;
  }

  it("serves no uuid regex and no MAX_SAFE_INTEGER anywhere, and still serves uuid formats", async () => {
    const tools = await granularTools();
    expect(tools.length).toBeGreaterThan(30);
    const all = JSON.stringify(tools.map((t) => t.inputSchema));
    expect(all).toContain('"format":"uuid"');
    expect(all).not.toContain("[89abAB]");
    expect(all).not.toContain(String(Number.MAX_SAFE_INTEGER));
  });

  it("serves no $schema, and nothing whose meaning depends on the dialect", async () => {
    const tools = await granularTools();
    for (const t of tools) expect(t.inputSchema, t.name).not.toHaveProperty("$schema");
    const all = JSON.stringify(tools.map((t) => t.inputSchema));
    for (const key of ['"$ref"', '"definitions"', '"$defs"', '"items":[', '"prefixItems"', '"additionalItems"', '"dependencies"']) {
      expect(all, key).not.toContain(key);
    }
  });

  it("publishes posture.tools as the three levels on both posture-taking tools", async () => {
    const tools = await granularTools();
    for (const name of ["dopl_launch_agent", "dopl_manage_session"]) {
      const t = tools.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      const posture = (t!.inputSchema.properties as Record<string, { properties: Record<string, { enum: string[] }> }>).posture;
      expect(posture.properties.tools.enum).toEqual(["ask", "auto", "full"]);
    }
  });

  it("still accepts every runtime word for posture.tools, granular and legacy (only the listing narrowed)", () => {
    const legacy = (CHANNEL_INPUT_SHAPE as Record<string, z.ZodType>).posture;
    for (const posture of [GRANULAR_POSTURE_FIELD, legacy]) {
      for (const word of ["ask", "auto", "full", "bypass", "accept_edits", "on-request", "run-everything"]) {
        expect(posture.safeParse({ tools: word }).success, word).toBe(true);
      }
      expect(posture.safeParse({ tools: "yolo" }).success).toBe(false);
    }
  });
});
