/**
 * `GET /api/user/onboarding-state` — the SPA's boot gate.
 *
 * THE PROPERTY THIS FILE EXISTS FOR: the desktop SPA has no RSC to run
 * `isOnboarded(user.id)` before it decides between `/onboarding` and the
 * workspace, so this route IS the gate. Two failure modes matter:
 *
 *   1. The gate must be per-caller. `isOnboarded` has to be asked about the
 *      AUTHENTICATED user id — a route that answered for anybody else would
 *      let one account's onboarding state route another's session.
 *   2. The gate must fail LOUD, not open. If the read throws and the route
 *      degrades to `{ isOnboarded: true }`, a brand-new user skips onboarding
 *      forever; the 500 is the correct answer.
 *
 * Only the auth token/session layer and the onboarding service are mocked —
 * the wrapper under test is the shipping `withUserAuth`, exercised end to end
 * from a real NextRequest, so the 401 path is the real one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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
// `getSessionUser` verifies the cookie LOCALLY via `getClaims()` (no GoTrue
// round-trip) — mock that, not `getUser()`.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: state.sessionUser ? { claims: { sub: state.sessionUser.id } } : null,
      }),
    },
  }),
}));

vi.mock("@/features/onboarding/server/service", () => ({
  isOnboarded: vi.fn(),
}));

import { GET } from "./route";
import { isOnboarded } from "@/features/onboarding/server/service";

const mockIsOnboarded = vi.mocked(isOnboarded);

const URL_ = "http://localhost/api/user/onboarding-state";

function getReq(): NextRequest {
  return new NextRequest(URL_, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionUser = { id: "user-1" };
});

describe("GET /api/user/onboarding-state", () => {
  it("reports a finished onboarding as { isOnboarded: true }", async () => {
    mockIsOnboarded.mockResolvedValue(true);

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isOnboarded: true });
  });

  it("reports an unfinished onboarding as { isOnboarded: false }", async () => {
    mockIsOnboarded.mockResolvedValue(false);

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isOnboarded: false });
  });

  it("asks about the AUTHENTICATED caller, not anyone else", async () => {
    state.sessionUser = { id: "user-42" };
    mockIsOnboarded.mockResolvedValue(true);

    await GET(getReq());
    expect(mockIsOnboarded).toHaveBeenCalledWith("user-42");
  });

  it("fails loud on a read error instead of degrading to 'onboarded'", async () => {
    // Degrading open here would silently skip onboarding for every new user.
    mockIsOnboarded.mockRejectedValue(new Error("db down"));

    const res = await GET(getReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("401s an unauthenticated caller without asking the service", async () => {
    state.sessionUser = null;

    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(mockIsOnboarded).not.toHaveBeenCalled();
  });
});
