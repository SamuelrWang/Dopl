/**
 * `GET /api/workspaces/resolve?segment=...` — the SPA router's face on
 * `resolveWorkspaceSegmentForUser`. The SPA has no RSC `redirect()`, so the slug-vs-publicId
 * disambiguation crosses the wire and must cross INTACT:
 *   1. ⚠ `needsRedirect` reported VERBATIM, both directions. Swallowing a `true` strands the SPA
 *      on a legacy URL (and `legacy_slug_redirect` telemetry never drops to zero); inventing one
 *      bounces the router on every canonical navigation.
 *   2. A miss is a plain 404 — the resolver is membership-scoped, so non-member and nonexistent
 *      arrive identically and must not be split into 403-vs-404.
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
  resolveWorkspaceSegmentForUser: vi.fn(),
}));

import { GET } from "./route";
import { resolveWorkspaceSegmentForUser } from "@/features/workspaces/server/segment";

const mockResolve = vi.mocked(resolveWorkspaceSegmentForUser);

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

const CANONICAL = "acme-abc123def456";

function getReq(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/workspaces/resolve${query}`, {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionUser = { id: "user-1" };
});

describe("GET /api/workspaces/resolve", () => {
  it("returns the workspace, canonical segment, and needsRedirect: false on a canonical hit", async () => {
    mockResolve.mockResolvedValue({
      workspace: WORKSPACE,
      canonical: CANONICAL,
      needsRedirect: false,
      role: "owner",
    });

    const res = await GET(getReq(`?segment=${CANONICAL}`), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      workspace: WORKSPACE,
      canonical: CANONICAL,
      needsRedirect: false,
    });
  });

  it("passes needsRedirect: true through on a legacy slug-only segment", async () => {
    // The SPA replaces history rather than 301ing, but it still needs the canonical.
    mockResolve.mockResolvedValue({
      workspace: WORKSPACE,
      canonical: CANONICAL,
      needsRedirect: true,
      role: "owner",
    });

    const res = await GET(getReq("?segment=acme"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { canonical: string; needsRedirect: boolean };
    expect(body.needsRedirect).toBe(true);
    expect(body.canonical).toBe(CANONICAL);
  });

  it("resolves the segment for the AUTHENTICATED caller", async () => {
    state.sessionUser = { id: "user-42" };
    mockResolve.mockResolvedValue({
      workspace: WORKSPACE,
      canonical: CANONICAL,
      needsRedirect: false,
      role: "owner",
    });

    await GET(getReq(`?segment=${CANONICAL}`), { params: Promise.resolve({}) });
    expect(mockResolve).toHaveBeenCalledWith(CANONICAL, "user-42");
  });

  it("trims surrounding whitespace before resolving", async () => {
    mockResolve.mockResolvedValue({
      workspace: WORKSPACE,
      canonical: CANONICAL,
      needsRedirect: false,
      role: "owner",
    });

    await GET(getReq(`?segment=%20${CANONICAL}%20`), { params: Promise.resolve({}) });
    expect(mockResolve).toHaveBeenCalledWith(CANONICAL, "user-1");
  });

  it("404s a miss — non-member and nonexistent are indistinguishable", async () => {
    mockResolve.mockResolvedValue(null);

    const res = await GET(getReq("?segment=someone-elses-workspace"), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("400s a missing segment param rather than resolving an empty string", async () => {
    const res = await GET(getReq(""), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MISSING_SEGMENT");
  });

  it("400s a blank segment param too", async () => {
    const res = await GET(getReq("?segment=%20%20"), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("surfaces a resolver failure as a 500 envelope, never as a 404", async () => {
    // A 404 would render "workspace not found" for a transient DB fault.
    mockResolve.mockRejectedValue(new Error("db down"));

    const res = await GET(getReq(`?segment=${CANONICAL}`), { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("never lets a CDN cache the per-caller resolution", async () => {
    mockResolve.mockResolvedValue({
      workspace: WORKSPACE,
      canonical: CANONICAL,
      needsRedirect: false,
      role: "owner",
    });

    const res = await GET(getReq(`?segment=${CANONICAL}`), { params: Promise.resolve({}) });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("401s an unauthenticated caller and resolves nothing", async () => {
    state.sessionUser = null;

    const res = await GET(getReq(`?segment=${CANONICAL}`), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
