/**
 * `withWorkspaceAuth` RUNG 2b — `workspaceFromParams` (2026-10-08). Same harness as
 * `with-workspace-auth.test.ts` (split for the 500-line cap). Original header:
 * `withWorkspaceAuth` wrapper concerns. Stubbed `withUserAuth` + the REAL
 * `resolveActiveWorkspace` over a mocked repository, so the actual resolution
 * plumbing runs:
 *   - `workspaceIdFromQuery` lets `?workspaceId=` participate; header wins;
 *   - API-key workspace lock wins over both (403 on mismatch);
 *   - `minRole` enforced after resolution;
 *   - no header resolves the caller's own container (ruling B10);
 *   - WORKSPACE_INVALID renders as the flat envelope.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type {
  Role,
  Workspace,
  WorkspaceMembership,
} from "@/features/workspaces/types";

const state = vi.hoisted(() => ({
  apiKeyWorkspaceId: null as string | null,
  credentialSubjectUserId: null as string | null,
  // Forwarding harness: `token` set → OAuth-bearer branch (re-enacting the
  // sessionOnly + write-scope gates from the forwarded `options`); else session.
  token: null as { userId: string; scopes: string[]; tokenId: string } | null,
  sessionUser: { id: "user-1" } as { id: string } | null,
}));

vi.mock("./with-auth", () => ({
  // Stand-in reproducing both gates FROM THE OPTIONS IT IS HANDED, so a 403 here
  // proves withWorkspaceAuth forwarded the flag. The gates themselves are
  // exercised against the real implementation in with-auth.test.ts.
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
          credentialSubjectUserId: state.credentialSubjectUserId,
          params: rc?.params,
        });
      }
      return handler(req, {
        userId: state.sessionUser?.id ?? "user-1",
        apiKeyWorkspaceId: state.apiKeyWorkspaceId,
        credentialSubjectUserId: state.credentialSubjectUserId,
        params: rc?.params,
      });
    },
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  listWorkspacesWithRoleForUser: vi.fn(),
  findWorkspaceById: vi.fn(),
  findMembership: vi.fn(),
  ensureHomeSpaceRow: vi.fn(),
}));
vi.mock("@/features/workspaces/server/last-seen", () => ({ touchLastSeen: vi.fn() }));
vi.mock("@/features/workspaces/server/seed-workspace", () => ({
  seedNewWorkspace: vi.fn(),
}));
vi.mock("@/features/analytics/server/mcp-tool-calls", () => ({
  logMcpToolCall: vi.fn(),
}));

import * as repo from "@/features/workspaces/server/repository";
import { withWorkspaceAuth } from "./with-workspace-auth";

const mockRepo = vi.mocked(repo);

const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
/** The caller's home space — never one of the granted memberships. */
const UUID_HOME = "cccccccc-cccc-cccc-cccc-cccccccccccc";

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

/**
 * Wire the repo so the given workspace ids resolve as active memberships, and
 * `home` as the caller's HOME SPACE — what a header-less request
 * resolves to (ruling B10). ⚠ The container is deliberately NOT one of
 * `entries`: a fixture where it is also a listed membership cannot tell
 * "answered the container" from "auto-targeted a workspace".
 */
function grantMemberships(
  entries: Array<{ id: string; slug: string; role: Role }>,
  home?: Role
) {
  const container = { ...workspace(UUID_HOME, "home"), kind: "home" as const };
  if (home) {
    entries = [...entries, { id: UUID_HOME, slug: "home", role: home }];
    mockRepo.ensureHomeSpaceRow.mockResolvedValue({ workspace: container, created: false });
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  mockRepo.findWorkspaceById.mockImplementation(async (id: string) =>
    id === UUID_HOME ? container : byId.has(id) ? workspace(id, byId.get(id)!.slug) : null
  );
  mockRepo.findMembership.mockImplementation(async (id: string) => {
    const e = byId.get(id);
    return e ? membership(e.id, e.role) : null;
  });
}


function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.apiKeyWorkspaceId = null;
  state.credentialSubjectUserId = "user-1";
  state.token = null;
  state.sessionUser = { id: "user-1" };
});

// 🔒 RUNG 2b (2026-10-08): an id-addressed route's own container. The bug it closes: a decision card
// in a home channel answered "Channel not found" because the header-less press resolved the HOME space.
describe("workspaceFromParams — the addressed resource names its container", () => {
  const derived = (value: string | null) => {
    const fn = vi.fn(async () => value);
    const route = withWorkspaceAuth(async (_req, ctx) => NextResponse.json({ workspaceId: ctx.workspaceId }), { workspaceFromParams: fn });
    return { fn, route };
  };

  it("no header, no lock → the resource's container, not home", async () => {
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const { route } = derived(UUID_A);
    const res = await route(req("/api/x"), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ workspaceId: UUID_A });
  });

  it("an explicit header still wins, and the resolver is never asked", async () => {
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }, { id: UUID_B, slug: "beta", role: "member" }]);
    const { fn, route } = derived(UUID_A);
    const res = await route(req("/api/x", { "x-workspace-id": UUID_B }), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ workspaceId: UUID_B });
    expect(fn).not.toHaveBeenCalled();
  });

  it("a key lock still wins, and the resolver is never asked", async () => {
    state.apiKeyWorkspaceId = UUID_B;
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }, { id: UUID_B, slug: "beta", role: "member" }]);
    const { fn, route } = derived(UUID_A);
    const res = await route(req("/api/x"), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ workspaceId: UUID_B });
    expect(fn).not.toHaveBeenCalled();
  });

  it("nothing derived (non-member, unknown id) → the caller's home, exactly as before", async () => {
    grantMemberships([], "owner");
    const { route } = derived(null);
    const res = await route(req("/api/x"), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ workspaceId: UUID_HOME });
  });
});
