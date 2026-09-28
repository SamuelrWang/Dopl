import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFakeDeviceStore } from "../testing/fake-device-store";
import { createFakeGlassesStore } from "../testing/fake-store";
import { registerGlassesTools } from "./tools";

const USER = "11111111-1111-4111-8111-111111111111";

async function connect(canWrite = true, charge?: () => Promise<string | null>) {
  const fake = createFakeGlassesStore();
  const server = new McpServer({ name: "dopl-glasses", version: "0" });
  registerGlassesTools(server, { store: fake.store, devices: createFakeDeviceStore().devices }, USER, { canWrite, charge });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, ...fake };
}

describe("glasses MCP server", () => {
  it("lists exactly the glasses tools", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "glasses_ask",
      "glasses_capabilities",
      "glasses_get_answer",
      "glasses_list_templates",
      "glasses_notify",
      "glasses_render",
      "glasses_save_template",
      "glasses_show",
      "glasses_status",
      "glasses_update",
      "glasses_use_template",
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

  it("renders a validate_only preview over MCP without needing write", async () => {
    const { client, rows } = await connect(false);
    const res = await client.callTool({
      name: "glasses_render",
      arguments: { blocks: [{ type: "text", content: "Hi" }], validate_only: true },
    });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse((res.content as { text: string }[])[0].text);
    expect(body.ok).toBe(true);
    expect(body.preview).toContain("[b1*] Hi");
    expect(rows).toHaveLength(0);
  });

  it("returns compile errors as JSON tool errors", async () => {
    const { client } = await connect();
    const res = await client.callTool({
      name: "glasses_render",
      arguments: { blocks: [{ type: "list", items: ["a"] }, { type: "list", items: ["b"] }] },
    });
    expect(res.isError).toBe(true);
    const body = JSON.parse((res.content as { text: string }[])[0].text);
    expect(body.errors[0].code).toBe("multiple_selectable");
  });

  it("charges each call once and refuses with the meter's message when the wallet is empty", async () => {
    let calls = 0;
    const { client, rows } = await connect(true, async () => (++calls > 1 ? "Your Dopl credits are used up for this period." : null));
    const ok = await client.callTool({ name: "glasses_notify", arguments: { title: "a", body: "b" } });
    expect(ok.isError).toBeFalsy();
    const refused = await client.callTool({ name: "glasses_notify", arguments: { title: "a", body: "b" } });
    expect(refused.isError).toBe(true);
    expect((refused.content as { text: string }[])[0].text).toContain("credits are used up");
    expect(rows).toHaveLength(1);
    expect(calls).toBe(2);
  });
});
