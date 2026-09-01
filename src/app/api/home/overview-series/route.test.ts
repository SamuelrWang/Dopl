/**
 * `GET /api/home/overview-series?range=&metric=[&workspaceId=]`.
 *
 * ⚠ THE SUITE'S CENTRE OF GRAVITY IS THE TWO METRICS THAT DO NOT EXIST.
 * `credits` and `tokens` are 400s, and they have to stay 400s: the credit
 * ledger is a per-PERIOD counter with no day and no user dimension (F-328), and
 * `channel_sessions.tokens_spent` is a live snapshot the desktop overwrites in
 * place. A chart of either would be a measurement nobody took.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { HomeOverviewSeries } from "@/features/home/overview-types";

const state = vi.hoisted(() => ({
  sessionUser: null as { id: string } | null,
}));

vi.mock("@/shared/auth/mcp-session", () => ({ touchMcpStatus: vi.fn() }));
vi.mock("@/features/analytics/server/mcp-events", () => ({ logMcpEvent: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({
  logSystemEvent: vi.fn(),
}));
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

vi.mock("@/features/home/server/service-overview", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/home/server/service-overview")
  >("@/features/home/server/service-overview");
  // ⚠ Both parsers are the thing under test — keep the REAL ones.
  return { ...actual, getHomeOverviewSeries: vi.fn() };
});

import { GET } from "./route";
import { getHomeOverviewSeries } from "@/features/home/server/service-overview";

const mockSeries = vi.mocked(getHomeOverviewSeries);

const USER_ID = "user-1";
const CONTAINER = "11111111-1111-4111-8111-111111111111";

const SERIES: HomeOverviewSeries = {
  range: "7d",
  metric: "mcp",
  bucket: "day",
  points: Array.from({ length: 7 }, (_, i) => ({
    at: `2026-08-${String(26 + i).padStart(2, "0")}T00:00:00.000Z`,
    count: 0,
  })),
  truncated: false,
};

/** ⚠ NEITHER ROUTE HAS A DYNAMIC SEGMENT — these are `/api/home/**`, fenced by
 *  the CALLER and not by a `[workspaceSlug]` — but `withUserAuth`'s handler
 *  signature still takes Next's route context, so the suite hands it an empty
 *  one rather than casting the call site. */
const routeCtx = () => ({ params: Promise.resolve({}) });

function getReq(query = "?range=7d&metric=mcp"): NextRequest {
  return new NextRequest(`http://localhost/api/home/overview-series${query}`, {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionUser = { id: USER_ID };
  mockSeries.mockResolvedValue(SERIES);
});

describe("GET /api/home/overview-series", () => {
  it("returns a zero-filled series for a recognised range + metric", async () => {
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as HomeOverviewSeries;
    expect(body.points).toHaveLength(7);
    expect(body.bucket).toBe("day");
    expect(mockSeries).toHaveBeenCalledWith(USER_ID, "7d", "mcp");
  });

  it("serves all three metrics off ONE route", async () => {
    for (const metric of ["credits", "mcp", "messages"] as const) {
      mockSeries.mockResolvedValue({ ...SERIES, metric });
      await GET(getReq(`?range=7d&metric=${metric}`), routeCtx());
      expect(mockSeries).toHaveBeenLastCalledWith(USER_ID, "7d", metric);
    }
  });

  /**
   * 🔒 REFUSED, NOT ANSWERED APPROXIMATELY. `tokens` has no per-bin source —
   * `channel_sessions.tokens_spent` is a running total the desktop rewrites in
   * place — so answering with a nearby series under that label is the
   * fabrication the whole face refuses.
   *
   * ⚠ **`credits` LEFT THIS LIST ON 2026-09-01.** It was refused because
   * `workspace_credit_usage` holds one row per BILLING PERIOD; the
   * `credit_usage_events` ledger added beside it has a per-burn timestamp, so
   * the metric is real (F-328).
   */
  it.each(["tokens", "threads", "calls"])("400s the metric %s", async (metric) => {
    const res = await GET(getReq(`?range=7d&metric=${metric}`), routeCtx());
    expect(res.status).toBe(400);
    expect(mockSeries).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_METRIC");
  });

  it("400s a MISSING metric rather than defaulting to one", async () => {
    const res = await GET(getReq("?range=7d"), routeCtx());
    expect(res.status).toBe(400);
    expect(mockSeries).not.toHaveBeenCalled();
  });

  it("400s the range BEFORE the metric — one refusal, in a fixed order", async () => {
    const res = await GET(getReq("?range=1h&metric=tokens"), routeCtx());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_RANGE");
  });

  /** 🔒 **NO `workspaceId` — the face is cross-channel since 2026-09-01.** A
   *  sender that still passes one gets the account-wide series; see
   *  `../overview/route.test.ts`, which carries why the param was removed. */
  it("IGNORES a workspaceId", async () => {
    await GET(getReq(`?range=24h&metric=mcp&workspaceId=${CONTAINER}`), routeCtx());
    expect(mockSeries).toHaveBeenCalledWith(USER_ID, "24h", "mcp");
  });

  /** ⚠ `month` is a real range on this route, and it is the only one the /home
   *  face asks for. */
  it("accepts the month window", async () => {
    await GET(getReq("?range=month&metric=credits"), routeCtx());
    expect(mockSeries).toHaveBeenCalledWith(USER_ID, "month", "credits");
  });

  it("never lets a CDN cache the per-caller payload", async () => {
    const res = await GET(getReq(), routeCtx());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("401s an unauthenticated caller and reads nothing", async () => {
    state.sessionUser = null;
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(401);
    expect(mockSeries).not.toHaveBeenCalled();
  });
});
