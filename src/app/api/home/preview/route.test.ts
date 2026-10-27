import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  sessionUser: null as { id: string } | null,
  rows: [] as Array<{ surface: string; payload: unknown }>,
}));

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
vi.mock("@/features/home/server/repository-preview", () => ({
  listOwnPreviewRows: vi.fn(async () => state.rows),
}));

import { GET } from "./route";
import { listOwnPreviewRows } from "@/features/home/server/repository-preview";

const routeCtx = () => ({ params: Promise.resolve({}) });
const getReq = (query = "") =>
  new NextRequest(`http://localhost/api/home/preview${query}`, { method: "GET" });

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionUser = { id: "user-1" };
  state.rows = [];
});

describe("GET /api/home/preview", () => {
  it("reads only the caller's rows and answers null for a surface with none", async () => {
    const res = await GET(getReq("?userId=someone-else"), routeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ overview: null, identities: null });
    expect(listOwnPreviewRows).toHaveBeenCalledWith("user-1");
  });

  it("drops invalid items and parts instead of failing", async () => {
    state.rows = [
      {
        surface: "overview",
        payload: {
          reachOrder: ["Even G2", "Samuel's MacBook Pro"],
          needs: [
            {
              id: "n1",
              kind: "approval",
              ask: "Wants to post in #Dopl",
              agent: "Release Captain",
              channelName: "Dopl",
              at: "2026-10-26T13:20:00.000Z",
            },
            { id: "n2", kind: "bogus" },
          ],
          addDevice: { pairingCode: "not a code" },
          hosts: "not a list",
        },
      },
      { surface: "identities", payload: { identities: [{ channels: [] }, { name: "Recruiter" }] } },
    ];
    const res = await GET(getReq(), routeCtx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.overview.reachOrder).toEqual(["Even G2", "Samuel's MacBook Pro"]);
    expect(body.overview.needs.map((n: { id: string }) => n.id)).toEqual(["n1"]);
    expect(body.overview.addDevice).toBeUndefined();
    expect(body.overview.hosts).toBeUndefined();
    expect(body.identities.identities).toHaveLength(1);
    expect(body.identities.identities[0]).toMatchObject({ name: "Recruiter", tools: [] });
    // Re-auth is per runtime, on the payload, not per identity.
    expect(body.identities.identities[0]).not.toHaveProperty("reauth");
    expect(body.identities.runtimes).toEqual([]);
  });

  it("401s without a session and reads nothing", async () => {
    state.sessionUser = null;
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(401);
    expect(listOwnPreviewRows).not.toHaveBeenCalled();
  });
});
