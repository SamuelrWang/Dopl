/**
 * NET-NEW (MCP-2) — `withWorkspaceAuth` wrapper concerns.
 *
 * Drives the wrapper with a stubbed `withUserAuth` (injects a fixed userId +
 * a configurable `apiKeyWorkspaceId`) and the REAL `resolveActiveWorkspace`
 * over a mocked repository, so this exercises the actual resolution plumbing:
 *
 *   - `workspaceIdFromQuery` lets `?workspaceId=` participate (the export
 *     download regression guard, A1) and a header still wins over it;
 *   - the API-key workspace lock still wins over both (403 on mismatch);
 *   - `minRole` is enforced after auto-target;
 *   - WORKSPACE_REQUIRED / WORKSPACE_INVALID render as the flat envelope.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type {
  Role,
  Workspace,
  WorkspaceMembership,
  WorkspaceWithRole,
} from "@/features/workspaces/types";

const state = vi.hoisted(() => ({
  apiKeyWorkspaceId: null as string | null,
  // H-3 forwarding harness. When `token` is set the mock takes the OAuth-bearer
  // branch (and re-enacts the sessionOnly + write-scope gates from the `options`
  // withWorkspaceAuth forwards); otherwise it takes the session (cookie) branch.
  token: null as { userId: string; scopes: string[]; tokenId: string } | null,
  sessionUser: { id: "user-1" } as { id: string } | null,
}));

vi.mock("./with-auth", () => ({
  // Faithful-enough stand-in for the REAL withUserAuth: it reproduces the two
  // H-3 gates *from the `options` it is handed*, so a 403 here proves
  // withWorkspaceAuth forwarded the flag. The gates themselves are exercised
  // against the real implementation in with-auth.test.ts; session (cookie)
  // callers are never gated, matching production.
  withUserAuth:
    (
      handler: (req: NextRequest, ctx: unknown) => unknown,
      options: { writeScopeExempt?: boolean; sessionOnly?: boolean } = {}
    ) =>
    (req: NextRequest, rc?: { params?: Promise<Record<string, string>> }) => {
      const READ = ["GET", "HEAD", "OPTIONS"];
      if (state.token) {
        if (options.sessionOnly) {
          return new Response(
            JSON.stringify({
              error: { code: "SESSION_REQUIRED", message: "session required" },
            }),
            { status: 403, headers: { "content-type": "application/json" } }
          );
        }
        const isWrite = !READ.includes(req.method);
        const canWrite =
          Array.isArray(state.token.scopes) &&
          state.token.scopes.includes("dopl.write");
        if (isWrite && !canWrite && !options.writeScopeExempt) {
          return new Response(
            JSON.stringify({
              error: {
                code: "WRITE_SCOPE_REQUIRED",
                message: "write scope required",
              },
            }),
            { status: 403, headers: { "content-type": "application/json" } }
          );
        }
        return handler(req, {
          userId: state.token.userId,
          agentTokenId: state.token.tokenId,
          apiKeyWorkspaceId: state.apiKeyWorkspaceId,
          params: rc?.params,
        });
      }
      return handler(req, {
        userId: state.sessionUser?.id ?? "user-1",
        apiKeyWorkspaceId: state.apiKeyWorkspaceId,
        params: rc?.params,
      });
    },
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  listWorkspacesWithRoleForUser: vi.fn(),
  findWorkspaceById: vi.fn(),
  findMembership: vi.fn(),
  findDefaultWorkspaceForUser: vi.fn(),
}));
vi.mock("@/features/workspaces/server/last-seen", () => ({ touchLastSeen: vi.fn() }));
vi.mock("@/features/workspaces/server/seed-workspace", () => ({
  seedNewWorkspace: vi.fn(),
}));
vi.mock("@/features/analytics/server/mcp-tool-calls", () => ({
  logMcpToolCall: vi.fn(),
}));

import * as repo from "@/features/workspaces/server/repository";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "./with-workspace-auth";

const mockRepo = vi.mocked(repo);

const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function wsWithRole(id: string, slug: string, role: Role): WorkspaceWithRole {
  return {
    id,
    ownerId: "owner",
    name: `${slug} ws`,
    slug,
    publicId: `pub-${id}`,
    description: null,
    iconUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role,
  };
}

function workspace(id: string, slug: string): Workspace {
  return {
    id,
    ownerId: "owner",
    name: `${slug} ws`,
    slug,
    publicId: `pub-${id}`,
    description: null,
    iconUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function membership(id: string, role: Role): WorkspaceMembership {
  return {
    workspaceId: id,
    userId: "user-1",
    role,
    status: "active",
    joinedAt: "2026-01-01T00:00:00Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: null,
  };
}

/** Wire the repo so the given workspace ids resolve as active memberships. */
function grantMemberships(entries: Array<{ id: string; slug: string; role: Role }>) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  mockRepo.findWorkspaceById.mockImplementation(async (id: string) => {
    const e = byId.get(id);
    return e ? workspace(e.id, e.slug) : null;
  });
  mockRepo.findMembership.mockImplementation(async (id: string) => {
    const e = byId.get(id);
    return e ? membership(e.id, e.role) : null;
  });
}

/** Echo handler — surfaces the resolved context for assertions. */
const echo = withWorkspaceAuth(async (_req, ctx) =>
  NextResponse.json({ workspaceId: ctx.workspaceId, role: ctx.role })
);
const echoWithQuery = withWorkspaceAuth(
  async (_req, ctx) => NextResponse.json({ workspaceId: ctx.workspaceId }),
  { workspaceIdFromQuery: true }
);

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, { headers });
}

function writeReq(
  method: string,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest("http://localhost/api/x", { method, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.apiKeyWorkspaceId = null;
  state.token = null;
  state.sessionUser = { id: "user-1" };
});

describe("workspaceIdFromQuery — export download regression (A1)", () => {
  it("resolves a header-less download via ?workspaceId= when the option is on", async () => {
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const res = await echoWithQuery(
      req(`/api/knowledge/bases/b/export?workspaceId=${UUID_A}`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspaceId: UUID_A });
  });

  it("ignores ?workspaceId= when the option is OFF (falls back to membership resolution)", async () => {
    // Two memberships + no header ⇒ ambiguous ⇒ 400, proving the query param
    // never participated in the default resolver.
    mockRepo.listWorkspacesWithRoleForUser.mockResolvedValue([
      wsWithRole(UUID_A, "acme", "member"),
      wsWithRole(UUID_B, "beta", "member"),
    ]);
    const res = await echo(req(`/api/x?workspaceId=${UUID_A}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("WORKSPACE_REQUIRED");
  });

  it("the header wins over the query param when both are present", async () => {
    grantMemberships([
      { id: UUID_A, slug: "acme", role: "member" },
      { id: UUID_B, slug: "beta", role: "member" },
    ]);
    const res = await echoWithQuery(
      req(`/api/x?workspaceId=${UUID_B}`, { "x-workspace-id": UUID_A })
    );
    expect(await res.json()).toEqual({ workspaceId: UUID_A });
  });

  it("export route: header W_h + query W_q → serves W_h (wrapper resolves, no divergent helper)", async () => {
    // The export routes now trust the wrapper-resolved `auth.workspaceId`
    // (resolveExportWorkspace was removed). Pin that a header outranks the
    // query param on an export-shaped request so a caller can't split the
    // resolved workspace from the served data.
    grantMemberships([
      { id: UUID_A, slug: "acme", role: "member" },
      { id: UUID_B, slug: "beta", role: "member" },
    ]);
    const res = await echoWithQuery(
      req(`/api/skills/my-skill/export?workspaceId=${UUID_B}`, {
        "x-workspace-id": UUID_A,
      })
    );
    expect(await res.json()).toEqual({ workspaceId: UUID_A });
  });
});

describe("API-key workspace lock (scaffolding, preserved)", () => {
  it("uses the key's workspace when no header is sent", async () => {
    state.apiKeyWorkspaceId = UUID_A;
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const res = await echo(req("/api/x"));
    expect(await res.json()).toEqual({ workspaceId: UUID_A, role: "member" });
  });

  it("403s when the requested workspace contradicts the key lock", async () => {
    state.apiKeyWorkspaceId = UUID_A;
    const res = await echo(req("/api/x", { "x-workspace-id": UUID_B }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("API_KEY_WORKSPACE_MISMATCH");
  });
});

describe("resolution outcomes surfaced by the wrapper", () => {
  it("auto-targets the sole membership with no header", async () => {
    mockRepo.listWorkspacesWithRoleForUser.mockResolvedValue([
      wsWithRole(UUID_A, "acme", "admin"),
    ]);
    grantMemberships([{ id: UUID_A, slug: "acme", role: "admin" }]);
    const res = await echo(req("/api/x"));
    expect(await res.json()).toEqual({ workspaceId: UUID_A, role: "admin" });
  });

  it("403 WORKSPACE_FORBIDDEN when the auto-targeted role is below minRole", async () => {
    mockRepo.listWorkspacesWithRoleForUser.mockResolvedValue([
      wsWithRole(UUID_A, "acme", "viewer"),
    ]);
    grantMemberships([{ id: UUID_A, slug: "acme", role: "viewer" }]);
    const guarded = withWorkspaceAuth(
      async (_req, ctx) => NextResponse.json({ workspaceId: ctx.workspaceId }),
      { minRole: "member" }
    );
    const res = await guarded(req("/api/x"));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("WORKSPACE_FORBIDDEN");
  });

  it("400 WORKSPACE_REQUIRED (flat envelope) for 2+ memberships with no header", async () => {
    mockRepo.listWorkspacesWithRoleForUser.mockResolvedValue([
      wsWithRole(UUID_A, "acme", "owner"),
      wsWithRole(UUID_B, "beta", "member"),
    ]);
    const res = await echo(req("/api/x"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "WORKSPACE_REQUIRED",
      message: expect.any(String),
      workspaces: [
        { name: "acme ws", slug: "acme", role: "owner" },
        { name: "beta ws", slug: "beta", role: "member" },
      ],
    });
  });

  it("400 WORKSPACE_INVALID (flat envelope) for a non-UUID header", async () => {
    const res = await echo(req("/api/x", { "x-workspace-id": "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("WORKSPACE_INVALID");
  });
});

describe("H-3 gate options are forwarded into withUserAuth", () => {
  // withWorkspaceAuth composes withUserAuth and must hand it BOTH new option
  // flags (see the `{ writeScopeExempt, sessionOnly }` forwarding at the tail
  // of withWorkspaceAuth). These assert the flags survive the composition —
  // drop the forwarding and (a) regresses to 200; the gate logic itself is
  // pinned in with-auth.test.ts.
  const writeHandler = vi.fn(
    async (_req: NextRequest, ctx: WorkspaceAuthContext) =>
      NextResponse.json({ workspaceId: ctx.workspaceId })
  );
  const sessionOnlyRoute = withWorkspaceAuth(writeHandler, { sessionOnly: true });
  const plainRoute = withWorkspaceAuth(writeHandler);

  it("(a) OAuth token on a sessionOnly route → 403 SESSION_REQUIRED (even with dopl.write)", async () => {
    state.sessionUser = null;
    state.token = { userId: "user-1", scopes: ["dopl.read", "dopl.write"], tokenId: "t1" };
    const res = await sessionOnlyRoute(
      writeReq("DELETE", { "x-workspace-id": UUID_A })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SESSION_REQUIRED");
    expect(writeHandler).not.toHaveBeenCalled();
  });

  it("(b) read-only OAuth token on a write method → 403 WRITE_SCOPE_REQUIRED", async () => {
    state.sessionUser = null;
    state.token = { userId: "user-1", scopes: ["dopl.read"], tokenId: "t1" };
    const res = await plainRoute(writeReq("PUT", { "x-workspace-id": UUID_A }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("WRITE_SCOPE_REQUIRED");
    expect(writeHandler).not.toHaveBeenCalled();
  });

  it("(c) session (cookie) caller on the same sessionOnly write route → allowed", async () => {
    // No token ⇒ cookie branch ⇒ neither gate applies; the real workspace
    // resolution runs and the write handler executes.
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const res = await sessionOnlyRoute(
      writeReq("DELETE", { "x-workspace-id": UUID_A })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspaceId: UUID_A });
    expect(writeHandler).toHaveBeenCalledOnce();
  });
});
