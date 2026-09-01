/**
 * `GET /api/home/overview?range=`.
 *
 * Pins the rules the shape depends on: an unrecognised `range` is a 400 and
 * never a default window, the payload is per-caller and uncacheable, and — since
 * 2026-09-01 — **the route takes no `workspaceId`**. That param used to narrow
 * the payload so the page could render a channel-scoped panel beside the
 * account-wide one, which is what made an operator with a single home channel
 * see every section twice. Its absence is asserted here, not just unimplemented.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import type { HomeOverview } from "@/features/home/overview-types";

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
  // ⚠ `parseRange` is the thing under test here — keep the REAL one.
  return { ...actual, getHomeOverview: vi.fn() };
});

import { GET } from "./route";
import { getHomeOverview } from "@/features/home/server/service-overview";

const mockOverview = vi.mocked(getHomeOverview);

const USER_ID = "user-1";
const CONTAINER = "11111111-1111-4111-8111-111111111111";

const OVERVIEW: HomeOverview = {
  range: "month",
  since: "2026-09-01T00:00:00.000Z",
  channels: [],
  people: [],
  tools: [],
  threads: [],
  agents: [],
  attention: [],
  scanned: 12,
  truncated: false,
};

/** ⚠ NEITHER ROUTE HAS A DYNAMIC SEGMENT — these are `/api/home/**`, fenced by
 *  the CALLER and not by a `[workspaceSlug]` — but `withUserAuth`'s handler
 *  signature still takes Next's route context, so the suite hands it an empty
 *  one rather than casting the call site. */
const routeCtx = () => ({ params: Promise.resolve({}) });

function getReq(query = "?range=month"): NextRequest {
  return new NextRequest(`http://localhost/api/home/overview${query}`, {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionUser = { id: USER_ID };
  mockOverview.mockResolvedValue(OVERVIEW);
});

describe("GET /api/home/overview", () => {
  it("answers the account-wide payload for a recognised range", async () => {
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as HomeOverview;
    expect(body.range).toBe("month");
    expect(mockOverview).toHaveBeenCalledWith(USER_ID, "month");
  });

  it("serves all four windows off ONE route — a query param, not four routes", async () => {
    for (const range of ["24h", "7d", "30d", "month"] as const) {
      await GET(getReq(`?range=${range}`), routeCtx());
      expect(mockOverview).toHaveBeenLastCalledWith(USER_ID, range);
    }
  });

  /**
   * 🔒 **THE `workspaceId` PARAM IS GONE AND MUST NOT COME BACK (2026-09-01).**
   * It is not a harmless option: it was the second half of a duplicate render —
   * the page read it into a channel-scoped panel stacked under the account-wide
   * one, built from the same components. A sender that still passes it must get
   * the account-wide payload, not a narrowing.
   */
  it("IGNORES a workspaceId — the face is cross-channel", async () => {
    await GET(getReq(`?range=30d&workspaceId=${CONTAINER}`), routeCtx());
    expect(mockOverview).toHaveBeenCalledWith(USER_ID, "30d");
    expect(mockOverview).not.toHaveBeenCalledWith(
      USER_ID,
      "30d",
      expect.anything()
    );
  });

  it("400s an unrecognised range and reads nothing", async () => {
    const res = await GET(getReq("?range=90d"), routeCtx());
    expect(res.status).toBe(400);
    expect(mockOverview).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_RANGE");
  });

  it("400s a MISSING range rather than defaulting to one", async () => {
    const res = await GET(getReq(""), routeCtx());
    expect(res.status).toBe(400);
    expect(mockOverview).not.toHaveBeenCalled();
  });

  /**
   * 🔒 THE FENCE IS THE CALLER'S OWN CONTAINERS, resolved inside the service —
   * nothing a caller sends reaches the service-role reads. An `HttpError` thrown
   * down there still surfaces with its own status rather than a 500.
   */
  it("surfaces a service HttpError with its own status", async () => {
    mockOverview.mockRejectedValue(
      new HttpError(404, "CHANNEL_NOT_FOUND", "Channel not found")
    );
    const res = await GET(getReq(`?range=month`), routeCtx());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CHANNEL_NOT_FOUND");
  });

  it("never lets a CDN cache the per-caller payload", async () => {
    const res = await GET(getReq(), routeCtx());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("401s an unauthenticated caller and reads nothing", async () => {
    state.sessionUser = null;
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(401);
    expect(mockOverview).not.toHaveBeenCalled();
  });
});
