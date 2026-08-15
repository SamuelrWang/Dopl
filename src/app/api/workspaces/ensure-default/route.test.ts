/**
 * `POST /api/workspaces/ensure-default` — the only route that PROVISIONS. Two properties:
 *   1. ⚠ IDEMPOTENCE IS THE CONTRACT. The SPA calls this on every cold boot; a second workspace
 *      per call forks the account. Convergence lives in `ensureDefaultWorkspace`; this pins that
 *      the ROUTE adds no create-per-request behaviour and stays 200, never 201.
 *   2. `segment` must be the canonical `{slug}-{publicId}` — the URL the client routes on.
 *      `workspaceSegment` is deliberately NOT mocked, so canonical-form drift fails here.
 * The shipping `withUserAuth` runs, so the 401 path is real.
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

vi.mock("@/features/workspaces/server/service", () => ({
  ensureDefaultWorkspace: vi.fn(),
}));

import { POST } from "./route";
import { ensureDefaultWorkspace } from "@/features/workspaces/server/service";

const mockEnsure = vi.mocked(ensureDefaultWorkspace);

const WORKSPACE: Workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  ownerId: "user-1",
  name: "Untitled",
  slug: "untitled",
  publicId: "abc123def456",
  description: null,
  iconUrl: null,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

const URL_ = "http://localhost/api/workspaces/ensure-default";

function postReq(): NextRequest {
  return new NextRequest(URL_, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionUser = { id: "user-1" };
});

describe("POST /api/workspaces/ensure-default", () => {
  it("returns the workspace plus the canonical routing segment", async () => {
    mockEnsure.mockResolvedValue(WORKSPACE);

    const res = await POST(postReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      workspace: WORKSPACE,
      segment: "untitled-abc123def456",
    });
  });

  it("provisions for the AUTHENTICATED caller, not a body-supplied id", async () => {
    state.sessionUser = { id: "user-42" };
    mockEnsure.mockResolvedValue(WORKSPACE);

    await POST(
      new NextRequest(URL_, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "someone-else" }),
      })
    );
    expect(mockEnsure).toHaveBeenCalledWith("user-42");
  });

  it("is idempotent: a repeat call yields the same workspace and no extra create", async () => {
    // A second workspace per launch would fork the account.
    mockEnsure.mockResolvedValue(WORKSPACE);

    const first = await (await POST(postReq())).json();
    const second = await (await POST(postReq())).json();
    expect(second).toEqual(first);
    // Provisioning is the service's single converging call.
    expect(mockEnsure).toHaveBeenCalledTimes(2);
    expect(mockEnsure).toHaveBeenNthCalledWith(2, "user-1");
  });

  it("answers 200, never 201 — the caller must not read it as 'newly created'", async () => {
    mockEnsure.mockResolvedValue(WORKSPACE);

    const res = await POST(postReq());
    expect(res.status).toBe(200);
  });

  it("surfaces a provisioning failure as a 500 envelope, not a half-answer", async () => {
    mockEnsure.mockRejectedValue(new Error("insert failed"));

    const res = await POST(postReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("401s an unauthenticated caller and provisions nothing", async () => {
    state.sessionUser = null;

    const res = await POST(postReq());
    expect(res.status).toBe(401);
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});
