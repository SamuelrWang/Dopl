/**
 * The `mcp_tool_calls` instrumentation inside `withWorkspaceAuth`.
 *
 * ⚠ THE RULE: an `X-MCP-Tool` name beginning with `_` is an INTERNAL call (the
 * MCP layer hitting our own infrastructure routes), not analytics.
 * `_mcp_credits_consume` fires on EVERY tool call, so logging it adds one insert
 * per call and puts a synthetic tool atop every usage query. The header is still
 * SENT; only the analytics write is skipped.
 *
 * Harness: `withUserAuth` stubbed so the OAuth-bearer branch is selectable (the
 * instrumentation is agent-callers only), the REAL `resolveActiveWorkspace`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type {
  Role,
  Workspace,
  WorkspaceMembership,
} from "@/features/workspaces/types";

const state = vi.hoisted(() => ({
  token: null as { userId: string; tokenId?: string } | null,
}));

vi.mock("./with-auth", () => ({
  withUserAuth:
    (handler: (req: NextRequest, ctx: unknown) => unknown) =>
    (req: NextRequest) =>
      handler(req, {
        userId: state.token?.userId ?? "user-1",
        agentTokenId: state.token?.tokenId,
        apiKeyWorkspaceId: null,
      }),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  listWorkspacesWithRoleForUser: vi.fn(),
  findWorkspaceById: vi.fn(),
  findMembership: vi.fn(),
  findDefaultWorkspaceForUser: vi.fn(),
}));
vi.mock("@/features/workspaces/server/last-seen", () => ({ touchLastSeen: vi.fn() }));
vi.mock("@/features/workspaces/server/seed-workspace", () => ({
  seedNewWorkspace: vi.fn(),
}));
vi.mock("@/features/analytics/server/mcp-tool-calls", () => ({
  logMcpToolCall: vi.fn(),
}));

import * as repo from "@/features/workspaces/server/repository";
import { logMcpToolCall } from "@/features/analytics/server/mcp-tool-calls";
import { withWorkspaceAuth } from "./with-workspace-auth";

const mockRepo = vi.mocked(repo);
const logged = vi.mocked(logMcpToolCall);
const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const echo = withWorkspaceAuth(async (_req, ctx) =>
  NextResponse.json({ workspaceId: ctx.workspaceId })
);

function agentReq(tool?: string, method = "POST"): NextRequest {
  const headers: Record<string, string> = { "x-workspace-id": UUID_A };
  if (tool) headers["x-mcp-tool"] = tool;
  return new NextRequest("http://localhost/api/x", { method, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.token = { userId: "user-1", tokenId: "t1" };
  mockRepo.findWorkspaceById.mockResolvedValue({
    id: UUID_A,
    ownerId: "owner",
    name: "acme ws",
    slug: "acme",
    publicId: `pub-${UUID_A}`,
    description: null,
    iconUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as Workspace);
  mockRepo.findMembership.mockResolvedValue({
    workspaceId: UUID_A,
    userId: "user-1",
    role: "member" as Role,
    status: "active",
    joinedAt: "2026-01-01T00:00:00Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: null,
  } as WorkspaceMembership);
});

describe("internal (`_`-prefixed) calls are not analytics", () => {
  it("does NOT log the per-tool-call credit spend", async () => {
    const res = await echo(agentReq("_mcp_credits_consume"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(logged).not.toHaveBeenCalled();
  });

  it("does NOT log the liveness ping either", async () => {
    await echo(agentReq("_mcp_status_ping"), { params: Promise.resolve({}) });
    expect(logged).not.toHaveBeenCalled();
  });

  it("the call itself still succeeds — this skips the log, not the request", async () => {
    const res = await echo(agentReq("_mcp_credits_consume"), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ workspaceId: UUID_A });
  });
});

describe("real tool calls are still instrumented", () => {
  it("logs a write, split into tool + op", async () => {
    await echo(agentReq("kb_write_file"), { params: Promise.resolve({}) });
    expect(logged).toHaveBeenCalledWith({
      workspaceId: UUID_A,
      userId: "user-1",
      tool: "kb",
      op: "write_file",
      isWrite: true,
    });
  });

  it("logs a read with isWrite false", async () => {
    await echo(agentReq("kb_read_file", "GET"), { params: Promise.resolve({}) });
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "kb", op: "read_file", isWrite: false })
    );
  });

  it("a separator-less name keeps the whole name as the tool", async () => {
    await echo(agentReq("ping"), { params: Promise.resolve({}) });
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ tool: "ping", op: "" })
    );
  });
});

describe("what is never instrumented", () => {
  it("a session (cookie) caller — no agent token, no log", async () => {
    state.token = { userId: "user-1" };
    await echo(agentReq("kb_write_file"), { params: Promise.resolve({}) });
    expect(logged).not.toHaveBeenCalled();
  });

  it("an agent request with no `X-MCP-Tool` header at all", async () => {
    await echo(agentReq(), { params: Promise.resolve({}) });
    expect(logged).not.toHaveBeenCalled();
  });
});
