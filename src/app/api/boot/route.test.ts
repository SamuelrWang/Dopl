/**
 * `POST /api/boot` — the properties that turn a performance fix into a correctness bug:
 *   1. a `segment` is RESOLVED, never guessed; a miss is a plain 404 with NO default fallback
 *      (a boot endpoint that guesses a workspace is a cross-tenant bug);
 *   2. provisioning stays gated on onboarding;
 *   3. the payload carries `role`, `userId` and `myAccess`;
 *   4. per-caller data is never CDN-cacheable.
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
  getBootState: vi.fn(),
}));

import { POST } from "./route";
import { getBootState } from "@/features/workspaces/server/segment";

const mockBoot = vi.mocked(getBootState);

const SEGMENT = "acme-abc123def456";

function postReq(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/boot", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function bootState(over: Record<string, unknown> = {}) {
  return {
    isOnboarded: true,
    surveyCompleted: true,
    userId: "user-1",
    workspace: { id: "ws-1", slug: "acme", publicId: "abc123def456" },
    segment: SEGMENT,
    needsRedirect: false,
    role: "owner",
    myAccess: { defaultLevel: "edit", overrides: [] },
    ...over,
  } as unknown as Awaited<ReturnType<typeof getBootState>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionUser = { id: "user-1" };
});

describe("POST /api/boot", () => {
  it("answers the whole launch in one payload for the no-segment mode", async () => {
    mockBoot.mockResolvedValue(bootState());

    const res = await POST(postReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      isOnboarded: true,
      userId: "user-1",
      segment: SEGMENT,
      role: "owner",
      myAccess: { defaultLevel: "edit", overrides: [] },
    });
    // No body = launch mode, not a validation failure.
    expect(mockBoot).toHaveBeenCalledWith("user-1", null);
  });

  it("passes a requested segment through to the fail-closed resolver", async () => {
    mockBoot.mockResolvedValue(bootState());

    await POST(postReq({ segment: SEGMENT }));
    expect(mockBoot).toHaveBeenCalledWith("user-1", SEGMENT);
  });

  it("404s a segment that does not resolve — never a default workspace", async () => {
    mockBoot.mockResolvedValue(null);

    const res = await POST(postReq({ segment: "someone-elses-ws" }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("reports the un-onboarded caller WITHOUT a workspace", async () => {
    mockBoot.mockResolvedValue(
      bootState({
        isOnboarded: false,
        workspace: null,
        segment: null,
        role: null,
        myAccess: null,
      })
    );

    const res = await POST(postReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isOnboarded: boolean; workspace: unknown };
    expect(body.isOnboarded).toBe(false);
    expect(body.workspace).toBeNull();
  });

  it("resolves for the AUTHENTICATED caller, not a caller-supplied id", async () => {
    state.sessionUser = { id: "user-42" };
    mockBoot.mockResolvedValue(bootState());

    await POST(postReq({ segment: SEGMENT }));
    expect(mockBoot).toHaveBeenCalledWith("user-42", SEGMENT);
  });

  it("401s an unauthenticated caller and resolves nothing", async () => {
    state.sessionUser = null;

    const res = await POST(postReq());
    expect(res.status).toBe(401);
    expect(mockBoot).not.toHaveBeenCalled();
  });

  it("400s a malformed segment rather than resolving a coerced one", async () => {
    const res = await POST(postReq({ segment: 42 }));
    expect(res.status).toBe(400);
    expect(mockBoot).not.toHaveBeenCalled();
  });

  it("never lets a CDN cache the per-caller payload", async () => {
    mockBoot.mockResolvedValue(bootState());

    const res = await POST(postReq());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
