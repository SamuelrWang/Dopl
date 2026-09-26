import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFakeGlassesStore } from "./fake-store";
import { createGlassesMcpServer } from "./tools";

const USER = "11111111-1111-4111-8111-111111111111";

async function connect(canWrite = true) {
  const fake = createFakeGlassesStore();
  const server = createGlassesMcpServer({ store: fake.store }, USER, { canWrite });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, ...fake };
}

describe("glasses MCP server", () => {
  it("lists exactly the five glasses tools", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "glasses_ask",
      "glasses_get_answer",
      "glasses_notify",
      "glasses_show",
      "glasses_status",
    ]);
    for (const t of tools) expect(t.description!.length).toBeLessThan(300);
  });

  it("calls glasses_notify for the authenticated user", async () => {
    const { client, rows } = await connect();
    const res = await client.callTool({ name: "glasses_notify", arguments: { title: "Hi", body: "there" } });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse((res.content as { text: string }[])[0].text);
    expect(body).toMatchObject({ status: "pending" });
    expect(rows[0].user_id).toBe(USER);
  });

  it("surfaces validation errors as fixable tool errors", async () => {
    const { client } = await connect();
    const res = await client.callTool({
      name: "glasses_ask",
      arguments: { question: "q".repeat(121), options: ["a", "b"] },
    });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toBe("question is 121 bytes; max 120. Shorten it.");
  });

  it("refuses writes without dopl.write but still answers reads", async () => {
    const { client, rows } = await connect(false);
    const res = await client.callTool({ name: "glasses_notify", arguments: { title: "Hi", body: "x" } });
    expect(res.isError).toBe(true);
    expect(rows).toHaveLength(0);
    const status = await client.callTool({ name: "glasses_status", arguments: {} });
    expect(status.isError).toBeFalsy();
  });
});
