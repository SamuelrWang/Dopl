/**
 * `GET /api/workspaces/[workspaceSlug]/overview-series?metric=`.
 * Pins the two rules the shape depends on: an unrecognised `metric` is a 400
 * and never a default series, and the metric is validated AFTER membership so a
 * 400 can never confirm a workspace a stranger cannot reach.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type {
  Workspace,
  WorkspaceOverviewSeries,
} from "@/features/workspaces/types";

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
vi.mock("@/features/workspaces/server/service-overview", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/workspaces/server/service-overview")
  >("@/features/workspaces/server/service-overview");
  // ⚠ `parseSeriesMetric` is the thing under test here — keep the REAL one.
  return { ...actual, getWorkspaceOverviewSeries: vi.fn() };
});

import { GET } from "./route";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { getWorkspaceOverviewSeries } from "@/features/workspaces/server/service-overview";

const mockResolve = vi.mocked(resolveApiWorkspace);
const mockSeries = vi.mocked(getWorkspaceOverviewSeries);

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

const SERIES: WorkspaceOverviewSeries = {
  metric: "messages",
  days: Array.from({ length: 31 }, (_, i) => ({
    date: `2026-07-${String(23 + i).padStart(2, "0")}`,
    count: 0,
  })),
};

const SEGMENT = "acme-abc123def456";

function getReq(query = "?metric=messages"): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${SEGMENT}/overview-series${query}`,
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
  mockSeries.mockResolvedValue(SERIES);
});

describe("GET /api/workspaces/[workspaceSlug]/overview-series", () => {
  it("returns a 31-point series for a recognised metric", async () => {
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspaceOverviewSeries;
    expect(body.metric).toBe("messages");
    expect(body.days).toHaveLength(31);
    expect(mockSeries).toHaveBeenCalledWith(WORKSPACE.id, "messages");
  });

  it("serves all three metrics off ONE route — a query param, not three routes", async () => {
    for (const metric of ["messages", "mcp", "threads"] as const) {
      mockSeries.mockResolvedValue({ ...SERIES, metric });
      const res = await GET(getReq(`?metric=${metric}`), routeCtx());
      expect(res.status).toBe(200);
      expect(mockSeries).toHaveBeenLastCalledWith(WORKSPACE.id, metric);
    }
  });

  it("400s an unrecognised metric and reads nothing", async () => {
    const res = await GET(getReq("?metric=sessions"), routeCtx());
    expect(res.status).toBe(400);
    expect(mockSeries).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_METRIC");
  });

  it("400s a MISSING metric rather than defaulting to one", async () => {
    const res = await GET(getReq(""), routeCtx());
    expect(res.status).toBe(400);
    expect(mockSeries).not.toHaveBeenCalled();
  });

  it("404s a non-member BEFORE validating the metric — 400 is not an oracle", async () => {
    mockResolve.mockResolvedValue(null);
    const res = await GET(getReq("?metric=sessions"), routeCtx());
    expect(res.status).toBe(404);
    expect(mockSeries).not.toHaveBeenCalled();
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
