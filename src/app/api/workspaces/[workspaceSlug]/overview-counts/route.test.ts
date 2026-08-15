/**
 * `GET /api/workspaces/[workspaceSlug]/overview-counts`.
 * ⚠ The counts bypass RLS (service-role client), so membership is the ONLY thing between a
 * stranger and a headcount of someone else's workspace. A null `resolveApiWorkspace` must 404
 * BEFORE any count query runs — counting first leaks through timing, and a 403 would confirm the
 * workspace exists.
 * Also pins two degradation rules: a failed MCP-status read → `false` (cosmetic badge), while a
 * failed COUNT read is the service's business — the route invents no zeroes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Workspace } from "@/features/workspaces/types";

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
vi.mock("@/features/workspaces/server/service", () => ({
  getWorkspaceOverviewCounts: vi.fn(),
}));
vi.mock("@/features/onboarding/server/service", () => ({
  isMcpConnected: vi.fn(),
}));

import { GET } from "./route";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { getWorkspaceOverviewCounts } from "@/features/workspaces/server/service";
import { isMcpConnected } from "@/features/onboarding/server/service";

const mockResolve = vi.mocked(resolveApiWorkspace);
const mockCounts = vi.mocked(getWorkspaceOverviewCounts);
const mockMcp = vi.mocked(isMcpConnected);

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

const COUNTS = { knowledgeBases: 2, skills: 7, members: 4 };

const SEGMENT = "acme-abc123def456";

function getReq(): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${SEGMENT}/overview-counts`,
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
  mockCounts.mockResolvedValue(COUNTS);
  mockMcp.mockResolvedValue(true);
});

describe("GET /api/workspaces/[workspaceSlug]/overview-counts", () => {
  it("returns the four counts flat, plus the MCP badge", async () => {
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...COUNTS, isMcpConnected: true });
  });

  it("counts the RESOLVED workspace and reads MCP status for the caller", async () => {
    await GET(getReq(), routeCtx());
    expect(mockResolve).toHaveBeenCalledWith(SEGMENT, "user-1");
    expect(mockCounts).toHaveBeenCalledWith(WORKSPACE.id);
    expect(mockMcp).toHaveBeenCalledWith("user-1");
  });

  it("404s a non-member WITHOUT running a single count query", async () => {
    // A null resolution IS the membership denial; the counts bypass RLS.
    mockResolve.mockResolvedValue(null);

    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(404);
    expect(mockCounts).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("uses the same 404 for a workspace that does not exist — existence is not an oracle", async () => {
    mockResolve.mockResolvedValue(null);
    const res = await GET(getReq(), routeCtx("nope-000000000000"));
    expect(res.status).toBe(404);
  });

  it("degrades a failed MCP-status read to false rather than 500ing the page", async () => {
    mockMcp.mockRejectedValue(new Error("mcp_tokens unavailable"));

    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...COUNTS, isMcpConnected: false });
  });

  it("surfaces a counts failure as a 500 envelope", async () => {
    mockCounts.mockRejectedValue(new Error("count failed"));

    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("does not echo the raw exception text in that 500", async () => {
    // ⚠ Raw `err.message` from a service-role read carries relation and RPC names
    // (ENGINEERING §9). The `code` agents parse is unchanged; the human text is sanitized.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCounts.mockRejectedValue(
      new Error('relation "workspace_counts_v2" does not exist')
    );

    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("workspace_counts_v2");
    expect(JSON.stringify(body)).not.toContain("does not exist");
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
