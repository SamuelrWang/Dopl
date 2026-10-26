import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { HomeNeeds } from "@/features/home/needs-types";

const state = vi.hoisted(() => ({ sessionUser: null as { id: string } | null }));

vi.mock("@/shared/auth/mcp-session", () => ({ touchMcpStatus: vi.fn() }));
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
vi.mock("@/features/home/server/service-needs", () => ({ getHomeNeeds: vi.fn() }));

import { GET } from "./route";
import { getHomeNeeds } from "@/features/home/server/service-needs";

const NEEDS: HomeNeeds = { decisions: [], tasks: [], truncated: { decisions: false, tasks: false } };
const routeCtx = () => ({ params: Promise.resolve({}) });
const getReq = (query = "") => new NextRequest(`http://localhost/api/home/needs${query}`, { method: "GET" });

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionUser = { id: "user-1" };
  vi.mocked(getHomeNeeds).mockResolvedValue(NEEDS);
});

describe("GET /api/home/needs", () => {
  it("answers the caller's needs, uncacheable, from no parameter", async () => {
    const res = await GET(getReq("?workspaceId=ws-x&userId=someone"), routeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual(NEEDS);
    expect(getHomeNeeds).toHaveBeenCalledWith("user-1");
  });

  it("401s without a session and reads nothing", async () => {
    state.sessionUser = null;
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(401);
    expect(getHomeNeeds).not.toHaveBeenCalled();
  });
});
