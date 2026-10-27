/**
 * The project-scoped MCP server: three tools (`deliver`, `context`, `actions`) over one project key.
 * It acts for the developer's product and its end users, not for a Dopl account; the prosumer MCP
 * (`packages/mcp-server`) is a different server and is untouched by this one.
 *
 * Small on purpose: three short tool definitions keep the context cost of connecting Dopl low.
 * Every tool calls exactly one SDK method (deliver also reads the user's context, best effort, so
 * the agent knows which device it wrote for).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Dopl } from "../client.js";
import { DoplError } from "../errors.js";

export const PROJECT_MCP_TOOLS = ["deliver", "context", "actions"] as const;

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

function fail(err: unknown): ToolResult {
  const body =
    err instanceof DoplError
      ? { error: { code: err.code, type: err.type, message: err.message, retryable: err.retryable, doc_url: err.docUrl } }
      : { error: { code: "unexpected", message: err instanceof Error ? err.message : String(err) } };
  return { content: [{ type: "text", text: JSON.stringify(body) }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

const userId = z.string().min(1).max(255).describe("Your id for the end user");

const deliverShape = z.object({
  external_user_id: userId,
  intent: z.enum(["message", "ask", "notify", "display"]),
  text: z.string().min(1).optional(),
  blocks: z.array(z.record(z.string(), z.unknown())).optional().describe("Display blocks"),
  options: z.array(z.string().min(1)).min(2).optional().describe("Choice labels"),
  urgency: z.enum(["low", "normal", "high"]).optional(),
  target: z.string().min(1).optional().describe("auto, a device kind, or a device id"),
  idempotency_key: z.string().min(1).max(255).optional(),
});

const contextShape = z.object({ external_user_id: userId });

const actionsShape = z.object({
  action_id: z.string().min(1).optional().describe("Read this action"),
  device_id: z.string().min(1).optional().describe("Run on this device"),
  capability: z.string().min(1).optional().describe("Capability id, e.g. present.notify"),
  args: z.record(z.string(), z.unknown()).optional(),
  idempotency_key: z.string().min(1).max(255).optional(),
});

export interface ProjectMcpOptions {
  name?: string;
  version?: string;
}

export function createProjectMcpServer(dopl: Dopl, opts: ProjectMcpOptions = {}): McpServer {
  const server = new McpServer({ name: opts.name ?? "dopl-project", version: opts.version ?? "0.1.0" });

  server.registerTool(
    "deliver",
    { description: "Deliver content to a user's device by intent; Dopl picks the device.", inputSchema: deliverShape },
    (a) =>
      run(async () => {
        const content: Record<string, unknown> = {};
        if (a.text !== undefined) content.text = a.text;
        if (a.blocks !== undefined) content.blocks = a.blocks;
        if (a.options !== undefined) content.options = a.options.map((label) => ({ label }));
        if (Object.keys(content).length === 0) throw new Error("deliver needs text, blocks or options.");
        const delivery = await dopl.users.deliver(
          a.external_user_id,
          {
            intent: a.intent,
            content: content as never,
            urgency: a.urgency ?? "normal",
            ...(a.target !== undefined ? { target: a.target } : {}),
          },
          { idempotencyKey: a.idempotency_key },
        );
        const context = await dopl.users.context(a.external_user_id).catch(() => null);
        return { delivery, context };
      }),
  );

  server.registerTool(
    "context",
    { description: "A user's active device, posture, available devices and profile.", inputSchema: contextShape },
    (a) => run(() => dopl.users.context(a.external_user_id)),
  );

  server.registerTool(
    "actions",
    {
      description: "Pass action_id to read an action, or device_id + capability (+ args) to run one.",
      inputSchema: actionsShape,
    },
    (a) =>
      run(async () => {
        if (a.action_id !== undefined) return dopl.actions.get(a.action_id);
        if (a.device_id === undefined || a.capability === undefined) {
          throw new Error("Pass action_id, or device_id and capability.");
        }
        return dopl.devices.action(a.device_id, a.capability as never, a.args ?? {}, {
          idempotencyKey: a.idempotency_key,
        });
      }),
  );

  return server;
}
