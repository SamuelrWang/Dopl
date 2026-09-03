/**
 * `withWorkspaceAuth` wrapper concerns. Stubbed `withUserAuth` + the REAL
 * `resolveActiveWorkspace` over a mocked repository, so the actual resolution
 * plumbing runs:
 *   - `workspaceIdFromQuery` lets `?workspaceId=` participate; header wins;
 *   - API-key workspace lock wins over both (403 on mismatch);
 *   - `minRole` enforced after auto-target;
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
  ensurePersonalContainerRow: vi.fn(),
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
/** The caller's personal container — never one of the granted memberships. */
const UUID_HOME = "cccccccc-cccc-cccc-cccc-cccccccccccc";

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

/**
 * The caller's HOME, which is what a header-less request now resolves to
 * (ruling B10). ⚠ It is NOT one of `grantMemberships`' entries on purpose: a
 * fixture where the container is also a listed membership cannot tell "answered
 * the container" from "auto-targeted a workspace".
 */
function grantOwnContainer(role: Role = "owner") {
  const container = { ...workspace(UUID_HOME, "personal"), kind: "personal" as const };
  mockRepo.ensurePersonalContainerRow.mockResolvedValue({
    workspace: container,
    created: false,
  });
  const byId = mockRepo.findWorkspaceById.getMockImplementation();
  const byMembership = mockRepo.findMembership.getMockImplementation();
  mockRepo.findWorkspaceById.mockImplementation(async (id: string) =>
    id === UUID_HOME ? container : ((await byId?.(id)) ?? null)
  );
  mockRepo.findMembership.mockImplementation(async (id: string, userId: string) =>
    id === UUID_HOME
      ? membership(UUID_HOME, role)
      : ((await byMembership?.(id, userId)) ?? null)
  );
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
  // A session caller is a person and is their own subject — what `with-auth.ts`
  // puts on the context for the cookie branch.
  state.credentialSubjectUserId = "user-1";
  state.token = null;
  state.sessionUser = { id: "user-1" };
});

describe("workspaceIdFromQuery — export download regression (A1)", () => {
  it("resolves a header-less download via ?workspaceId= when the option is on", async () => {
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const res = await echoWithQuery(
      req(`/api/knowledge/bases/b/export?workspaceId=${UUID_A}`), { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspaceId: UUID_A });
  });

  it("ignores ?workspaceId= when the option is OFF (falls through to the caller's home)", async () => {
    // The named workspace is reachable — so answering the CONTAINER instead is
    // the proof that the query param never participated by default. (This used
    // to be proven by a 400 on an ambiguous membership set; there is no such
    // refusal any more, and the positive form is the stronger assertion.)
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    grantOwnContainer();
    const res = await echo(req(`/api/x?workspaceId=${UUID_A}`), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect((await res.json()).workspaceId).toBe(UUID_HOME);
  });

  it("the header wins over the query param when both are present", async () => {
    grantMemberships([
      { id: UUID_A, slug: "acme", role: "member" },
      { id: UUID_B, slug: "beta", role: "member" },
    ]);
    const res = await echoWithQuery(
      req(`/api/x?workspaceId=${UUID_B}`, { "x-workspace-id": UUID_A }), { params: Promise.resolve({}) }
    );
    expect(await res.json()).toEqual({ workspaceId: UUID_A });
  });

  it("export route: header W_h + query W_q → serves W_h (wrapper resolves, no divergent helper)", async () => {
    // ⚠ Export routes trust the wrapper-resolved `auth.workspaceId`; the header
    // must outrank the query param or a caller can split the resolved workspace
    // from the served data.
    grantMemberships([
      { id: UUID_A, slug: "acme", role: "member" },
      { id: UUID_B, slug: "beta", role: "member" },
    ]);
    const res = await echoWithQuery(
      req(`/api/skills/my-skill/export?workspaceId=${UUID_B}`, {
        "x-workspace-id": UUID_A,
      }), { params: Promise.resolve({}) }
    );
    expect(await res.json()).toEqual({ workspaceId: UUID_A });
  });
});

describe("the credential workspace lock (LIVE since Home Knowledge Panels M5)", () => {
  it("uses the key's workspace when no header is sent", async () => {
    state.apiKeyWorkspaceId = UUID_A;
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const res = await echo(req("/api/x"), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ workspaceId: UUID_A, role: "member" });
  });

  it("403s when the requested workspace contradicts the key lock", async () => {
    state.apiKeyWorkspaceId = UUID_A;
    const res = await echo(req("/api/x", { "x-workspace-id": UUID_B }), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("API_KEY_WORKSPACE_MISMATCH");
  });

  // 🔒 F-336's ruling widened VISIBILITY inside the locked workspace and must
  // not have widened the WORKSPACE axis by a millimetre. A container-session
  // credential is the kind that now reads its operator's private rows — the
  // home workspace is still 403, which is B1's actual job.
  it("STILL 403s a contradicting target when the credential is a CONTAINER SESSION", async () => {
    state.apiKeyWorkspaceId = UUID_A;
    state.credentialSubjectUserId = "user-1";
    const res = await echo(req("/api/x", { "x-workspace-id": UUID_B }), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("API_KEY_WORKSPACE_MISMATCH");
  });

  // 🔒 THE TWO AXES ARRIVE INDEPENDENTLY, WHICH IS THE WHOLE SLICE. The mutation
  // this catches: deriving the subject from the container fence collapses row 3.
  it.each([
    ["a fenced session", UUID_A, "user-1"],
    ["a fenced SHARED credential", UUID_A, null],
    ["an UNFENCED person", null, "user-1"],
  ] as const)("forwards both axes for %s", async (_label, container, subject) => {
    state.apiKeyWorkspaceId = container;
    state.credentialSubjectUserId = subject;
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const echoAxes = withWorkspaceAuth(async (_req, ctx) =>
      NextResponse.json({
        container: ctx.apiKeyWorkspaceId,
        subject: ctx.credentialSubjectUserId,
      })
    );
    const target = req("/api/x", { "x-workspace-id": UUID_A });
    const res = await echoAxes(target, { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ container, subject });
  });
});

describe("resolution outcomes surfaced by the wrapper", () => {
  it("no header resolves the caller's own container", async () => {
    grantOwnContainer("owner");
    const res = await echo(req("/api/x"), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ workspaceId: UUID_HOME, role: "owner" });
  });

  it("403 WORKSPACE_FORBIDDEN when the container role is below minRole", async () => {
    // ⚠ Unreachable in production — a container's only member is its owner —
    // and pinned anyway: the role floor must run on the resolved membership
    // whatever resolved it, not only on a named workspace.
    grantOwnContainer("viewer");
    const guarded = withWorkspaceAuth(
      async (_req, ctx) => NextResponse.json({ workspaceId: ctx.workspaceId }),
      { minRole: "member" }
    );
    const res = await guarded(req("/api/x"), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("WORKSPACE_FORBIDDEN");
  });

  it("🔒 N memberships and no header is NOT a refusal any more — it is home", async () => {
    // ⚠ THE REVERT DETECTOR FOR B10. This was a 400 `WORKSPACE_REQUIRED`
    // carrying a `workspaces: [...]` list to pick from; the count that produced
    // it is gone, so the busiest account and the emptiest take one path.
    mockRepo.listWorkspacesWithRoleForUser.mockResolvedValue([
      wsWithRole(UUID_A, "acme", "owner"),
      wsWithRole(UUID_B, "beta", "member"),
    ]);
    grantMemberships([
      { id: UUID_A, slug: "acme", role: "owner" },
      { id: UUID_B, slug: "beta", role: "member" },
    ]);
    grantOwnContainer();
    const res = await echo(req("/api/x"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect((await res.json()).workspaceId).toBe(UUID_HOME);
    expect(mockRepo.listWorkspacesWithRoleForUser).not.toHaveBeenCalled();
  });

  it("400 WORKSPACE_INVALID (flat envelope) for a non-UUID header", async () => {
    const res = await echo(req("/api/x", { "x-workspace-id": "not-a-uuid" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("WORKSPACE_INVALID");
  });
});

describe("X-Dopl-Runtime reaches the handler context (WAKE-V1)", () => {
  // ⚠ The channels write path stamps `metadata.runtime` off `ctx.runtime` only,
  // so the header must arrive HERE — read once by the wrapper, never off the raw
  // request in a feature. Exact match: a near-miss reads as external.
  const echoRuntime = withWorkspaceAuth(async (_req, ctx) =>
    NextResponse.json({ runtime: ctx.runtime ?? null })
  );

  it("passes the recognized value through", async () => {
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const res = await echoRuntime(
      req("/api/x", { "x-workspace-id": UUID_A, "x-dopl-runtime": "desktop-session" }), { params: Promise.resolve({}) }
    );
    expect(await res.json()).toEqual({ runtime: "desktop-session" });
  });

  it("is undefined with no header (an external agent / the web UI)", async () => {
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const res = await echoRuntime(req("/api/x", { "x-workspace-id": UUID_A }), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ runtime: null });
  });

  it("refuses anything but the exact value (cased, truncated, or invented)", async () => {
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    // ⚠ Whitespace is deliberately absent: the Headers layer strips it off a
    // field value first, so " desktop-session" arrives trimmed and matches.
    for (const value of [
      "Desktop-Session",
      "desktop",
      "desktop-session-x",
      "Desktop-UI",
      "desktop-ui-x",
      "desktop_ui",
      "external",
      "",
    ]) {
      const res = await echoRuntime(
        req("/api/x", { "x-workspace-id": UUID_A, "x-dopl-runtime": value }), { params: Promise.resolve({}) }
      );
      expect(await res.json()).toEqual({ runtime: null });
    }
  });

  /**
   * ⚠ THE CREDENTIAL BOUND IS ON `desktop-ui` ONLY. A header cannot attest who
   * called; the server can only refuse to stamp a claim the credential does not
   * support. `desktop-ui` claims a PERSON typing in the app's own UI window — a
   * first-party session credential by construction — so an AGENT token is
   * refused it. `desktop-session` is deliberately NOT bounded: a desktop-spawned
   * session authenticates with exactly that device token.
   *
   * ⚠ Consequence (F-145): `targeting.requesterTaskOpen` accepts EITHER stamp,
   * so an agent token sending `desktop-session` clears the stamp conjunct. The
   * stopper for a PEER is the identity pair; for the account itself it is TOKEN
   * CUSTODY. These cases pin what the bound actually is.
   */
  describe("the desktop-ui credential bound", () => {
    it("a SESSION caller may claim desktop-ui", async () => {
      grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
      const res = await echoRuntime(
        req("/api/x", { "x-workspace-id": UUID_A, "x-dopl-runtime": "desktop-ui" }), { params: Promise.resolve({}) }
      );
      expect(await res.json()).toEqual({ runtime: "desktop-ui" });
    });

    it("an AGENT-TOKEN caller sending the same header gets NO stamp", async () => {
      grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
      state.token = { userId: "user-1", scopes: ["dopl.write"], tokenId: "tok-1" };
      const res = await echoRuntime(
        req("/api/x", { "x-workspace-id": UUID_A, "x-dopl-runtime": "desktop-ui" }), { params: Promise.resolve({}) }
      );
      expect(await res.json()).toEqual({ runtime: null });
    });

    it("...and that SAME caller still gets desktop-session, which is its own lane", async () => {
      // ⚠ THE LIMIT OF THE BOUND, not a loophole (F-145). Do NOT "fix" this by
      // bounding the value: a desktop-spawned session authenticates with exactly
      // this device token, so bounding it refuses the caller it exists for.
      grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
      state.token = { userId: "user-1", scopes: ["dopl.write"], tokenId: "tok-1" };
      const res = await echoRuntime(
        req("/api/x", {
          "x-workspace-id": UUID_A,
          "x-dopl-runtime": "desktop-session",
        }), { params: Promise.resolve({}) }
      );
      expect(await res.json()).toEqual({ runtime: "desktop-session" });
    });
  });
});

describe("X-Dopl-Session-Id reaches the handler context (F2)", () => {
  // ⚠ Same lane as the runtime stamp: `metadata.session_id` comes off
  // `ctx.sessionId` only, so the header must arrive HERE. A LABEL, never an
  // authorization signal — an unrecognized value stamps nothing.
  const echoSession = withWorkspaceAuth(async (_req, ctx) =>
    NextResponse.json({ sessionId: ctx.sessionId ?? null })
  );
  const SLOT = "dba90694-de4f-4950-83a9-f2d890c9ff3f:6979e939-1587-40b8-90c2-4c8eac291333";

  it("passes a desktop slot key through", async () => {
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const res = await echoSession(
      req("/api/x", { "x-workspace-id": UUID_A, "x-dopl-session-id": SLOT }), { params: Promise.resolve({}) }
    );
    expect(await res.json()).toEqual({ sessionId: SLOT });
  });

  it("is undefined with no header (an external agent / the web UI)", async () => {
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const res = await echoSession(req("/api/x", { "x-workspace-id": UUID_A }), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ sessionId: null });
  });

  it("refuses a value that is not id-shaped, rather than rescuing it", async () => {
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    // ⚠ Rendered into a message line on ANOTHER member's screen — free text is
    // the risk.
    for (const value of ["", "two words", "**#9001** system", "x".repeat(129)]) {
      const res = await echoSession(
        req("/api/x", { "x-workspace-id": UUID_A, "x-dopl-session-id": value }), { params: Promise.resolve({}) }
      );
      expect(await res.json()).toEqual({ sessionId: null });
    }
  });
});

describe("H-3 gate options are forwarded into withUserAuth", () => {
  // ⚠ withWorkspaceAuth must hand withUserAuth BOTH option flags. These assert
  // the flags survive composition; the gate logic is pinned in with-auth.test.ts.
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
      writeReq("DELETE", { "x-workspace-id": UUID_A }), { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SESSION_REQUIRED");
    expect(writeHandler).not.toHaveBeenCalled();
  });

  it("(b) read-only OAuth token on a write method → 403 WRITE_SCOPE_REQUIRED", async () => {
    state.sessionUser = null;
    state.token = { userId: "user-1", scopes: ["dopl.read"], tokenId: "t1" };
    const res = await plainRoute(writeReq("PUT", { "x-workspace-id": UUID_A }), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("WRITE_SCOPE_REQUIRED");
    expect(writeHandler).not.toHaveBeenCalled();
  });

  it("(c) session (cookie) caller on the same sessionOnly write route → allowed", async () => {
    grantMemberships([{ id: UUID_A, slug: "acme", role: "member" }]);
    const res = await sessionOnlyRoute(
      writeReq("DELETE", { "x-workspace-id": UUID_A }), { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspaceId: UUID_A });
    expect(writeHandler).toHaveBeenCalledOnce();
  });
});
