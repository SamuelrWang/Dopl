/**
 * `GET /api/workspaces/[workspaceSlug]/overview`.
 * ⚠ Every read behind this route bypasses RLS (service-role client), so
 * membership is the ONLY thing between a stranger and someone else's workspace.
 * A null `resolveApiWorkspace` must 404 BEFORE the service runs, and a 403
 * would confirm the workspace exists.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Workspace, WorkspaceOverview } from "@/features/workspaces/types";

const state = vi.hoisted(() => ({
  sessionUser: null as { id: string } | null,
}));

vi.mock("@/shared/auth/mcp-session", () => ({ touchMcpStatus: vi.fn() }));
vi.mock("@/features/analytics/server/mcp-events", () => ({ logMcpEvent: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
vi.mock("@/shared/auth/mcp-oauth", () => ({
  validateAccessToken: vi.fn(async () => null),
  isOAuthAccessToken: (token: string) => token.startsWith("dopl_at_"),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: state.sessionUser ? { claims: { sub: state.sessionUser.id } } : null,
      }),
    },
  }),
}));

vi.mock("@/features/workspaces/server/segment", () => ({
  resolveApiWorkspace: vi.fn(),
}));
vi.mock("@/features/workspaces/server/service-overview", () => ({
  getWorkspaceOverview: vi.fn(),
}));

import { GET } from "./route";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { getWorkspaceOverview } from "@/features/workspaces/server/service-overview";

const mockResolve = vi.mocked(resolveApiWorkspace);
const mockOverview = vi.mocked(getWorkspaceOverview);

const WORKSPACE: Workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerId: "user-1",
  name: "Acme",
  slug: "acme",
  publicId: "abc123def456",
  description: null,
  iconUrl: null,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

const OVERVIEW: WorkspaceOverview = {
  counts: { messagesToday: 12, agentsRunning: 2, members: 5, channels: 7 },
  activity: [
    {
      id: "message:m1",
      channelId: "c1",
      channelName: "general",
      kind: "message",
      actorName: "Ada",
      preview: "shipped it",
      at: "2026-08-22T09:00:00.000Z",
    },
  ],
  memberLoad: {
    totalMessages: 40,
    rows: [{ userId: "u1", name: "Ada", percent: 60 }],
  },
};

const SEGMENT = "acme-abc123def456";

function getReq(): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${SEGMENT}/overview`,
    { method: "GET" }
  );
}

function routeCtx(workspaceSlug = SEGMENT) {
  return { params: Promise.resolve({ workspaceSlug }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionUser = { id: "user-1" };
  mockResolve.mockResolvedValue(WORKSPACE);
  mockOverview.mockResolvedValue(OVERVIEW);
});

describe("GET /api/workspaces/[workspaceSlug]/overview", () => {
  it("returns the WorkspaceOverview shape unwrapped", async () => {
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(OVERVIEW);
  });

  it("passes the RESOLVED workspace AND the caller — activity is viewer-fenced", async () => {
    await GET(getReq(), routeCtx());
    expect(mockResolve).toHaveBeenCalledWith(SEGMENT, "user-1");
    expect(mockOverview).toHaveBeenCalledWith(WORKSPACE.id, "user-1");
  });

  it("404s a non-member WITHOUT running a single read", async () => {
    mockResolve.mockResolvedValue(null);

    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(404);
    expect(mockOverview).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("uses the same 404 for a workspace that does not exist — existence is not an oracle", async () => {
    mockResolve.mockResolvedValue(null);
    const res = await GET(getReq(), routeCtx("nope-000000000000"));
    expect(res.status).toBe(404);
  });

  it("surfaces a read failure as a 500 envelope, inventing no zeroes", async () => {
    mockOverview.mockRejectedValue(new Error("count failed"));

    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("does not echo the raw exception text in that 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockOverview.mockRejectedValue(
      new Error('relation "channel_sessions" does not exist')
    );

    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("channel_sessions");
    spy.mockRestore();
  });

  it("400s a missing route segment instead of resolving an empty slug", async () => {
    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MISSING_WORKSPACE_SLUG");
  });

  it("never lets a CDN cache the per-caller payload", async () => {
    const res = await GET(getReq(), routeCtx());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("401s an unauthenticated caller and resolves nothing", async () => {
    state.sessionUser = null;

    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(401);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
