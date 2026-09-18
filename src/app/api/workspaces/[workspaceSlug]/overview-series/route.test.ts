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
  return {
    ...actual,
    getWorkspaceOverviewSeries: vi.fn(),
    isChannelVisibleTo: vi.fn(),
  };
});

import { GET } from "./route";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import {
  getWorkspaceOverviewSeries,
  isChannelVisibleTo,
} from "@/features/workspaces/server/service-overview";

const mockResolve = vi.mocked(resolveApiWorkspace);
const mockSeries = vi.mocked(getWorkspaceOverviewSeries);
const mockVisible = vi.mocked(isChannelVisibleTo);

const CHANNEL_ID = "22222222-2222-4222-8222-222222222222";

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
  mockVisible.mockResolvedValue(true);
});

describe("GET /api/workspaces/[workspaceSlug]/overview-series", () => {
  it("returns a 31-point series for a recognised metric", async () => {
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as WorkspaceOverviewSeries;
    expect(body.metric).toBe("messages");
    expect(body.days).toHaveLength(31);
    // ⚠ NO `range` → the pre-wave-8 fixed window, passed EXPLICITLY. The Info
    // tab's activity strip is the caller that never sends one, and its 31 days
    // must not have moved.
    expect(mockSeries).toHaveBeenCalledWith(
      WORKSPACE.id,
      "messages",
      null,
      expect.any(Date),
      "31d"
    );
  });

  it("serves all four metrics off ONE route — a query param, not four routes", async () => {
    for (const metric of ["messages", "mcp", "threads", "credits"] as const) {
      mockSeries.mockResolvedValue({ ...SERIES, metric });
      const res = await GET(getReq(`?metric=${metric}`), routeCtx());
      expect(res.status).toBe(200);
      expect(mockSeries).toHaveBeenLastCalledWith(
        WORKSPACE.id,
        metric,
        null,
        expect.any(Date),
        "31d"
      );
    }
  });

  it("passes a recognised range through and 400s an unrecognised one", async () => {
    const ok = await GET(getReq("?metric=credits&range=month"), routeCtx());
    expect(ok.status).toBe(200);
    expect(mockSeries).toHaveBeenLastCalledWith(
      WORKSPACE.id,
      "credits",
      null,
      expect.any(Date),
      "month"
    );
    mockSeries.mockClear();
    // ⚠ `24h` is not in this host's set: the bin is a calendar DAY here.
    for (const bad of ["24h", "", "Month", "90d"]) {
      const res = await GET(getReq(`?metric=credits&range=${bad}`), routeCtx());
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("INVALID_RANGE");
    }
    expect(mockSeries).not.toHaveBeenCalled();
  });

  it("404s a GUEST by taking the resolver's INVERTED DEFAULT, never an override", async () => {
    // 🔒 The unscoped series is a workspace-wide aggregate with no channel
    // fence, so the guest floor is the only thing between a guest and 31 days of
    // volume across every room in the container. It is the resolver's
    // `minRole: "viewer"` default — this route must pass no override.
    await GET(getReq("?metric=messages"), routeCtx());
    expect(mockResolve.mock.calls[0][2]).not.toHaveProperty("minRole");

    mockResolve.mockResolvedValue(null);
    const res = await GET(getReq("?metric=messages"), routeCtx());
    expect(res.status).toBe(404);
    expect(mockSeries).toHaveBeenCalledTimes(1);
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

/**
 * `channelId` — the narrowing view (2026-08-25).
 *
 * ⚠ THE FENCE IS THE WHOLE SUBJECT. These counts run as SERVICE ROLE, so RLS is
 * not a backstop (INVARIANTS §2) and workspace membership is not enough: a
 * member of a workspace is not a reader of every PRIVATE channel in it. Without
 * the visibility check this route reports, day by day, how busy a room the
 * caller cannot open was.
 */
describe("?channelId= — the narrowing view and its fence", () => {
  it("passes a VISIBLE channel through to the series", async () => {
    const res = await GET(
      getReq(`?metric=messages&channelId=${CHANNEL_ID}`),
      routeCtx()
    );
    expect(res.status).toBe(200);
    expect(mockVisible).toHaveBeenCalledWith(WORKSPACE.id, "user-1", CHANNEL_ID);
    expect(mockSeries).toHaveBeenCalledWith(
      WORKSPACE.id,
      "messages",
      CHANNEL_ID,
      expect.any(Date),
      "31d"
    );
  });

  it("404s a channel the caller cannot see, and COUNTS NOTHING", async () => {
    mockVisible.mockResolvedValue(false);
    const res = await GET(
      getReq(`?metric=messages&channelId=${CHANNEL_ID}`),
      routeCtx()
    );
    expect(res.status).toBe(404);
    // ⚠ The refusal has to land BEFORE the read, not merely instead of the
    // answer: a service-role count that ran and was then discarded is still a
    // query somebody's private room paid for.
    expect(mockSeries).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CHANNEL_NOT_FOUND");
  });

  it("⚠ 404, NOT 403 — 'cannot see' and 'does not exist' answer identically", async () => {
    mockVisible.mockResolvedValue(false);
    const hidden = await GET(
      getReq(`?metric=messages&channelId=${CHANNEL_ID}`),
      routeCtx()
    );
    mockResolve.mockResolvedValue(null);
    const stranger = await GET(
      getReq(`?metric=messages&channelId=${CHANNEL_ID}`),
      routeCtx()
    );
    expect(hidden.status).toBe(stranger.status);
    expect(hidden.status).toBe(404);
  });

  it("does NOT pay the visibility read when no channel was asked for", async () => {
    await GET(getReq("?metric=messages"), routeCtx());
    expect(mockVisible).not.toHaveBeenCalled();
  });

  it("fences BEFORE the metric is validated — a 400 must not confirm a channel", async () => {
    // Same ordering rule the workspace resolution follows one line up: a
    // validation error that fires first would tell a caller their channelId
    // was real.
    mockVisible.mockResolvedValue(false);
    const res = await GET(
      getReq(`?metric=messages&channelId=${CHANNEL_ID}`),
      routeCtx()
    );
    expect(res.status).toBe(404);
  });
});
