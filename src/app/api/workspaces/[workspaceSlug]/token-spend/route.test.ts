/**
 * `GET /api/workspaces/[workspaceSlug]/token-spend`.
 *
 * ⚠ **THE SUBJECT IS THE FENCE, not the payload.** `workspace_token_spend` is
 * operator-fenced by its own migration and R-29(b) left that standing, so the
 * one thing this route must never do is read a container without also naming the
 * caller.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Workspace } from "@/features/workspaces/types";

const state = vi.hoisted(() => ({
  sessionUser: null as { id: string } | null,
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
vi.mock("@/features/workspaces/server/segment", () => ({
  resolveApiWorkspace: vi.fn(),
}));
vi.mock("@/features/workspaces/server/service-usage", () => ({
  getWorkspaceTokenSpend: vi.fn(),
}));

import { GET } from "./route";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { getWorkspaceTokenSpend } from "@/features/workspaces/server/service-usage";

const mockResolve = vi.mocked(resolveApiWorkspace);
const mockSpend = vi.mocked(getWorkspaceTokenSpend);

const SEGMENT = "acme-abc123def456";
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

function getReq(): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${SEGMENT}/token-spend`,
    { method: "GET" }
  );
}

const routeCtx = (workspaceSlug = SEGMENT) => ({
  params: Promise.resolve({ workspaceSlug }),
});

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionUser = { id: "user-1" };
  mockResolve.mockResolvedValue(WORKSPACE);
  mockSpend.mockResolvedValue({ marks: [], truncated: false });
});

describe("GET /api/workspaces/[workspaceSlug]/token-spend", () => {
  it("reads the container AND the caller — never the container alone", async () => {
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(200);
    expect(mockSpend).toHaveBeenCalledWith(WORKSPACE.id, "user-1");
  });

  it("404s a non-member and reads nothing", async () => {
    mockResolve.mockResolvedValue(null);
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(404);
    expect(mockSpend).not.toHaveBeenCalled();
  });

  it("404s a GUEST by taking the resolver's INVERTED DEFAULT, never an override", async () => {
    // 🔒 The floor is `segment.ts › ApiWorkspaceOpts`'s `minRole: "viewer"`
    // default, so a guest gets the same 404 a non-member does. The fence is that
    // this route passes NO `minRole` — an override here would silently re-open
    // the hole `docs/MEMBERS-AUTHORIZATION.md` records being closed on
    // 2026-08-26.
    await GET(getReq(), routeCtx());
    const opts = mockResolve.mock.calls[0][2];
    expect(opts).not.toHaveProperty("minRole");

    mockResolve.mockResolvedValue(null);
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found" },
    });
    expect(mockSpend).toHaveBeenCalledTimes(1);
  });

  it("401s an unauthenticated caller and resolves nothing", async () => {
    state.sessionUser = null;
    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(401);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("400s a missing route segment instead of resolving an empty slug", async () => {
    const res = await GET(getReq(), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("never lets a CDN cache the per-caller payload", async () => {
    const res = await GET(getReq(), routeCtx());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
