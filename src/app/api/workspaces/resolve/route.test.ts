/**
 * `GET /api/workspaces/resolve?segment=...` — the SPA router's twin of
 * `resolvePageWorkspace`.
 *
 * THE PROPERTY THIS FILE EXISTS FOR: on the web, a stale `{slug}` in the URL
 * is corrected by an RSC `redirect()` the user never sees. The SPA has no such
 * hook, so the whole slug-vs-publicId disambiguation has to cross the wire —
 * and it has to cross it INTACT:
 *
 *   1. `needsRedirect` must be reported verbatim from the resolver, both
 *      directions. Swallowing a `true` leaves the SPA sitting on a legacy URL
 *      forever (and the `legacy_slug_redirect` telemetry that gates deleting
 *      the legacy path never drops to zero); inventing a `true` bounces the
 *      router on every canonical navigation.
 *   2. A miss must be a plain 404. The resolver is membership-scoped, so
 *      "not a member" and "does not exist" arrive identically — the route must
 *      not split them back apart into 403-vs-404 and turn workspace existence
 *      into an oracle.
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
    });

    const res = await GET(getReq(`?segment=${CANONICAL}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      workspace: WORKSPACE,
      canonical: CANONICAL,
      needsRedirect: false,
    });
  });

  it("passes needsRedirect: true through on a legacy slug-only segment", async () => {
    // The web path 301s here; the SPA replaces history instead. Either way it
    // needs to be TOLD, and it needs the canonical to rewrite to.
    mockResolve.mockResolvedValue({
      workspace: WORKSPACE,
      canonical: CANONICAL,
      needsRedirect: true,
    });

    const res = await GET(getReq("?segment=acme"));
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
    });

    await GET(getReq(`?segment=${CANONICAL}`));
    expect(mockResolve).toHaveBeenCalledWith(CANONICAL, "user-42");
  });

  it("trims surrounding whitespace before resolving", async () => {
    mockResolve.mockResolvedValue({
      workspace: WORKSPACE,
      canonical: CANONICAL,
      needsRedirect: false,
    });

    await GET(getReq(`?segment=%20${CANONICAL}%20`));
    expect(mockResolve).toHaveBeenCalledWith(CANONICAL, "user-1");
  });

  it("404s a miss — non-member and nonexistent are indistinguishable", async () => {
    mockResolve.mockResolvedValue(null);

    const res = await GET(getReq("?segment=someone-elses-workspace"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("400s a missing segment param rather than resolving an empty string", async () => {
    const res = await GET(getReq(""));
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MISSING_SEGMENT");
  });

  it("400s a blank segment param too", async () => {
    const res = await GET(getReq("?segment=%20%20"));
    expect(res.status).toBe(400);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("surfaces a resolver failure as a 500 envelope, never as a 404", async () => {
    // A 404 here would make the SPA render "workspace not found" for what is
    // actually a transient DB fault.
    mockResolve.mockRejectedValue(new Error("db down"));

    const res = await GET(getReq(`?segment=${CANONICAL}`));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("never lets a CDN cache the per-caller resolution", async () => {
    mockResolve.mockResolvedValue({
      workspace: WORKSPACE,
      canonical: CANONICAL,
      needsRedirect: false,
    });

    const res = await GET(getReq(`?segment=${CANONICAL}`));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("401s an unauthenticated caller and resolves nothing", async () => {
    state.sessionUser = null;

    const res = await GET(getReq(`?segment=${CANONICAL}`));
    expect(res.status).toBe(401);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
