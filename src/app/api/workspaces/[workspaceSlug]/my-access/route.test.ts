/**
 * `GET /api/workspaces/[workspaceSlug]/my-access`.
 * ⚠ `opts.role` is THREADED from the segment resolve into `listEffectiveAccess` so the same
 * membership row is not read twice. The fix is invisible in the response, so only this test stops
 * a refactor from "simplifying" the call back to two arguments.
 * ⚠ A teams-mode resource with NO grant must serialize as `level: "read"`, never be omitted — the
 * client reads a missing entry as the role default ("edit" for members), flipping a just-revoked
 * KB panel back to editable.
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
  resolveApiWorkspaceAccess: vi.fn(),
}));
vi.mock("@/features/teams/server/access", async () => {
  const actual = await vi.importActual<typeof import("@/features/teams/server/access")>(
    "@/features/teams/server/access"
  );
  return { ...actual, listEffectiveAccess: vi.fn() };
});

import { GET } from "./route";
import { resolveApiWorkspaceAccess } from "@/features/workspaces/server/segment";
import { listEffectiveAccess } from "@/features/teams/server/access";

const mockResolve = vi.mocked(resolveApiWorkspaceAccess);
const mockAccess = vi.mocked(listEffectiveAccess);

const SEGMENT = "acme-abc123def456";
const WS_ID = "11111111-1111-4111-8111-111111111111";

function req(): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${SEGMENT}/my-access`,
    { method: "GET" }
  );
}

const ctx = { params: Promise.resolve({ workspaceSlug: SEGMENT }) };

beforeEach(() => {
  vi.clearAllMocks();
  state.sessionUser = { id: "user-1" };
});

describe("GET /api/workspaces/[workspaceSlug]/my-access", () => {
  it("threads the resolved role instead of re-fetching the membership", async () => {
    mockResolve.mockResolvedValue({
      workspace: { id: WS_ID } as never,
      role: "member",
    });
    mockAccess.mockResolvedValue({
      defaultLevel: "edit",
      isAdmin: false,
      teamsModeResources: [],
    });

    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith(WS_ID, "user-1", { role: "member" });
  });

  it("serializes an ungranted teams-mode resource as read, never as omission", async () => {
    mockResolve.mockResolvedValue({
      workspace: { id: WS_ID } as never,
      role: "member",
    });
    mockAccess.mockResolvedValue({
      defaultLevel: "edit",
      isAdmin: false,
      teamsModeResources: [
        { resourceType: "knowledge_base", resourceId: "kb-1", level: null },
        { resourceType: "knowledge_base", resourceId: "kb-2", level: "edit" },
      ],
    });

    const res = await GET(req(), ctx);
    expect(await res.json()).toEqual({
      defaultLevel: "edit",
      overrides: [
        { resourceType: "knowledge_base", resourceId: "kb-1", level: "read" },
        { resourceType: "knowledge_base", resourceId: "kb-2", level: "edit" },
      ],
    });
  });

  it("404s a workspace the caller cannot resolve, and computes no access", async () => {
    mockResolve.mockResolvedValue(null);

    const res = await GET(req(), ctx);
    expect(res.status).toBe(404);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("never lets a CDN cache the per-caller matrix", async () => {
    mockResolve.mockResolvedValue({
      workspace: { id: WS_ID } as never,
      role: "owner",
    });
    mockAccess.mockResolvedValue({
      defaultLevel: "edit",
      isAdmin: true,
      teamsModeResources: [],
    });

    const res = await GET(req(), ctx);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
