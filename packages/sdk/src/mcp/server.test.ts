import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { BASE, CONTEXT, DELIVERY, SK, action, client } from "../test-helpers.js";
import type { Reply } from "../test-helpers.js";
import { PROJECT_MCP_TOOLS, createProjectMcpServer } from "./server.js";

async function connect(...replies: Reply[]) {
  const { dopl, calls } = client(SK, ...replies);
  const server = createProjectMcpServer(dopl);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "probe", version: "0.0.0" });
  await Promise.all([server.connect(b), mcp.connect(a)]);
  return { mcp, calls };
}

const textOf = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0].text);

describe("project MCP server", () => {
  it("lists exactly deliver, context and actions, with short descriptions", async () => {
    const { mcp } = await connect();
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["actions", "context", "deliver"]);
    expect([...PROJECT_MCP_TOOLS].sort()).toEqual(["actions", "context", "deliver"]);
    for (const t of tools) expect((t.description ?? "").length).toBeLessThanOrEqual(100);
    expect(JSON.stringify(tools).length).toBeLessThan(4000);
  });

  it("deliver calls users.deliver, then reads context", async () => {
    const { mcp, calls } = await connect({ status: 202, body: DELIVERY }, { body: CONTEXT });
    const res = await mcp.callTool({
      name: "deliver",
      arguments: { external_user_id: "usr_1", intent: "ask", text: "Ship?", options: ["Yes", "No"], idempotency_key: "k" },
    });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toEqual({ delivery: DELIVERY, context: CONTEXT });
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/users/usr_1/deliver` });
    expect(calls[0].body).toEqual({
      intent: "ask",
      content: { text: "Ship?", options: [{ label: "Yes" }, { label: "No" }] },
      urgency: "normal",
      idempotency_key: "k",
    });
    expect(calls[1]).toMatchObject({ method: "GET", url: `${BASE}/users/usr_1/context` });
  });

  it("context calls users.context", async () => {
    const { mcp, calls } = await connect({ body: CONTEXT });
    const res = await mcp.callTool({ name: "context", arguments: { external_user_id: "usr_1" } });
    expect(textOf(res)).toEqual(CONTEXT);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${BASE}/users/usr_1/context`]);
  });

  it("actions with action_id calls actions.get", async () => {
    const { mcp, calls } = await connect({ body: action("done") });
    const res = await mcp.callTool({ name: "actions", arguments: { action_id: "act_9" } });
    expect(textOf(res).status).toBe("done");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${BASE}/actions/act_9`]);
  });

  it("actions with device_id + capability calls devices.action", async () => {
    const { mcp, calls } = await connect({ status: 202, body: { action_id: "act_1", status: "queued" } });
    await mcp.callTool({
      name: "actions",
      arguments: { device_id: "dev_1", capability: "present.notify", args: { title: "Hi" }, idempotency_key: "k3" },
    });
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/devices/dev_1/actions/present.notify` });
    expect(calls[0].body).toEqual({ args: { title: "Hi" }, idempotency_key: "k3" });
  });

  it("returns a C10 error as an isError result", async () => {
    const error = {
      type: "permission_error",
      code: "grant_missing",
      message: "No grant.",
      retryable: false,
      doc_url: "https://www.usedopl.com/docs/errors/grant-missing",
    };
    const { mcp } = await connect({ status: 403, body: { error } });
    const res = await mcp.callTool({ name: "context", arguments: { external_user_id: "u" } });
    expect(res.isError).toBe(true);
    expect(textOf(res).error).toMatchObject({ code: "grant_missing", doc_url: error.doc_url });
  });

  it("actions without an id or a device refuses without a request", async () => {
    const { mcp, calls } = await connect();
    const res = await mcp.callTool({ name: "actions", arguments: {} });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
