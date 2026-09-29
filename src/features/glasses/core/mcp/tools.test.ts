import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFakeDeviceStore } from "../testing/fake-device-store";
import { createFakeGlassesStore } from "../testing/fake-store";
import { DoplApiError } from "@dopl/client";
import { registerGlassesTools } from "./tools";

const USER = "11111111-1111-4111-8111-111111111111";

async function connect(canWrite = true, charge?: () => Promise<string | null>) {
  const fake = createFakeGlassesStore();
  const server = new McpServer({ name: "dopl-glasses", version: "0" });
  const shown: unknown[] = [];
  const show = async (input: unknown) => {
    shown.push(input);
    return { display_id: "s-1", glasses: "shown", glasses_message_id: "g-1", status: "pending" };
  };
  registerGlassesTools(server, { store: fake.store, devices: createFakeDeviceStore().devices }, USER, { canWrite, charge, show });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, shown, ...fake };
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

  it("glasses_ask is a shortcut over the display door, in its old return shape", async () => {
    const { client, shown } = await connect();
    const res = await client.callTool({ name: "glasses_ask", arguments: { question: "Ship?", options: ["Yes", "No"], timeout_sec: 30 } });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse((res.content as { text: string }[])[0].text)).toEqual({ id: "g-1", status: "pending", answer: null, note: expect.any(String) });
    expect(shown).toEqual([
      {
        target: "glasses",
        shortcut: "ask",
        origin: "glasses_ask",
        blocks: [
          { id: "question", type: "text", content: "Ship?" },
          { id: "options", type: "choice", options: [{ label: "Yes" }, { label: "No" }] },
        ],
        wait: true,
        timeout_sec: 30,
      },
    ]);
  });

  it("glasses_render reads v1 blocks (a selectable list is a choice)", async () => {
    const { client, shown } = await connect();
    const res = await client.callTool({ name: "glasses_render", arguments: { screen_id: "s-a", blocks: [{ type: "list", items: ["a", "b"] }] } });
    expect(JSON.parse((res.content as { text: string }[])[0].text)).toEqual({ id: "g-1", screen_id: "s-1", status: "pending" });
    expect(shown[0]).toMatchObject({ display_id: "s-a", blocks: [{ type: "choice", options: [{ label: "a" }, { label: "b" }] }] });
  });

  it("surfaces the door's 400 text as a fixable tool error", async () => {
    const fake = createFakeGlassesStore();
    const server = new McpServer({ name: "dopl-glasses", version: "0" });
    const body = JSON.stringify({ error: { code: "DISPLAY_INVALID", message: "question is 121 bytes; max 120. Shorten it." } });
    registerGlassesTools(server, { store: fake.store, devices: createFakeDeviceStore().devices }, USER, {
      canWrite: true,
      show: async () => {
        throw new DoplApiError(400, body);
      },
    });
    const client = new Client({ name: "test", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const res = await client.callTool({ name: "glasses_ask", arguments: { question: "q", options: ["a", "b"] } });
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

  it("runs validate_only without needing write", async () => {
    const { client, shown } = await connect(false);
    const res = await client.callTool({ name: "glasses_render", arguments: { blocks: [{ type: "text", content: "Hi" }], validate_only: true } });
    expect(res.isError).toBeFalsy();
    expect(shown[0]).toMatchObject({ validate_only: true });
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
