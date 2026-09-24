/**
 * The consume route tallies the MCP call it charges (`mcp_tool_calls`, tool prefixed `mcp:`) —
 * off the response path, shape-checked, and silent on anything it cannot read.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const insert = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: Request, ctx: Partial<WorkspaceAuthContext>) => Promise<Response>) =>
    (req: Request) =>
      handler(req, { userId: "user-1", workspaceId: "ws-1" }),
}));
vi.mock("@/features/billing/server/credits-service", () => ({
  consumeMcpCredits: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({ from: () => ({ insert }) }),
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("http://x/api/mcp/credits/consume", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }) as never,
    {} as never
  );

beforeEach(() => insert.mockClear());

describe("consume tallies the call it charges", () => {
  it("writes one prefixed row for a well-formed call", async () => {
    const res = await post({ call: { tool: "dopl_channel", op: "rooms.update", write: true } });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      user_id: "user-1",
      tool: "mcp:dopl_channel",
      op: "rooms.update",
      is_write: true,
    });
  });

  it("tallies an op-less tool with an empty op", async () => {
    await post({ call: { tool: "dopl_map", op: "", write: false } });
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({ tool: "mcp:dopl_map", op: "", is_write: false });
  });

  it.each([
    ["no call (a fan-out leg)", {}],
    ["a foreign tool", { call: { tool: "kb", op: "x", write: false } }],
    ["an op outside the grammar", { call: { tool: "dopl_kb", op: "DROP TABLE", write: false } }],
    ["a body that is not JSON", "not json"],
  ])("charges without a row for %s", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(insert).not.toHaveBeenCalled();
  });
});
