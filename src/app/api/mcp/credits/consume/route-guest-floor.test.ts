/**
 * THE GUEST CONSUME PATH, END TO END (2026-08-26 — Samuel: "charge MCP calls
 * from a guest to the user"; closes F-325).
 *
 * Drives the REAL exported `POST` through the REAL `withWorkspaceAuth` and the
 * REAL `credits-service`, with only the credential harness and the two
 * repositories mocked. That is deliberate: the bug this file exists for was a
 * DEFAULT (`minRole` unset → `viewer`) plus a ROUTING rule (whose workspace
 * pays), and no assertion about either one separately would have caught it —
 * the route 403'd, `registrar.ts › charge` swallowed the throw, and every guest
 * tool call ran free with one log line to show for it.
 *
 * Four claims, each red under a different single revert:
 *   1. A GUEST-scoped call is ACCEPTED (200, not 403 WORKSPACE_FORBIDDEN).
 *   2. Its credit lands on the CONTAINER OWNER's billing workspace — never the
 *      guest's own, and never the container.
 *   3. The owner's own call in their own container is unchanged.
 *   4. An owner with no billing workspace runs UNMETERED, allowed, stamped
 *      `degraded`, AND LOGGED — the documented fail-open, not silence.
 *
 * ⚠ THE FLOOR AND THE ROUTING ARE ONE FIX, NOT TWO. Reverting `minRole:"guest"`
 * fails (1); reverting the owner resolution in `resolveBillingTarget` fails (2)
 * while (1) still passes. Shipping either half alone is a bug with no test.
 *
 * ⚠ A SIBLING OF `route.test.ts` RATHER THAN A SECTION IN IT, AND THE REASON IS
 * STRUCTURAL: that file mocks `withWorkspaceAuth` AWAY to reach the plan/period
 * arithmetic directly, which is exactly the thing a floor test must not do —
 * `vi.mock` is file-scoped, so the two mock strategies cannot share a module.
 * Neither file is redundant: that one owns the entitlement verdict, this one
 * owns who is admitted and whose counter moves.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type {
  Role,
  Workspace,
  WorkspaceMembership,
} from "@/features/workspaces/types";

const state = vi.hoisted(() => ({ userId: "guest-user" }));

// Credential harness: the OAuth-agent-token shape every MCP caller has. The
// write-scope gate is NOT re-enacted here — `writeScopeExempt` is pinned in
// `shared/auth/with-workspace-auth.test.ts`; this file is about the ROLE floor.
vi.mock("@/shared/auth/with-auth", () => ({
  withUserAuth:
    (handler: (req: NextRequest, ctx: unknown) => unknown) =>
    (req: NextRequest) =>
      handler(req, { userId: state.userId, agentTokenId: "tok-1" }),
}));
vi.mock("@/features/workspaces/server/repository", () => ({
  listWorkspacesWithRoleForUser: vi.fn(),
  findWorkspaceById: vi.fn(),
  findMembership: vi.fn(),
  findActiveOwnerUserId: vi.fn(),
  findSoleOwnedStandardWorkspace: vi.fn(),
}));
vi.mock("@/features/workspaces/server/last-seen", () => ({
  touchLastSeen: vi.fn(),
}));
vi.mock("@/features/workspaces/server/seed-workspace", () => ({
  seedNewWorkspace: vi.fn(),
}));
vi.mock("@/features/analytics/server/mcp-tool-calls", () => ({
  logMcpToolCall: vi.fn(),
}));
vi.mock("@/features/billing/server/workspace-billing", () => ({
  getWorkspaceBilling: vi.fn(),
  countActiveMembers: vi.fn(),
  countOntologyObjects: vi.fn(),
  consumeWorkspaceCredits: vi.fn(),
  getWorkspaceCreditsUsed: vi.fn(),
}));

import * as repo from "@/features/workspaces/server/repository";
import * as billing from "@/features/billing/server/workspace-billing";
import { POST } from "./route";

const mockRepo = vi.mocked(repo);
const mockBilling = vi.mocked(billing);

const CONTAINER = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OWNER_WS = "0000ffff-0000-ffff-0000-ffffffffffff";
const GUEST_WS = "9999aaaa-9999-aaaa-9999-aaaaaaaaaaaa";
const OWNER = "operator-user";
const GUEST = "guest-user";

function workspace(id: string, kind: "standard" | "link"): Workspace {
  return {
    id,
    ownerId: OWNER,
    name: `ws ${id}`,
    slug: `ws-${id.slice(0, 4)}`,
    publicId: `pub-${id.slice(0, 4)}`,
    description: null,
    iconUrl: null,
    kind,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function membership(workspaceId: string, role: Role): WorkspaceMembership {
  return {
    workspaceId,
    userId: state.userId,
    role,
    status: "active",
    joinedAt: "2026-01-01T00:00:00Z",
    invitedBy: null,
    invitedAt: null,
    lastSeenAt: null,
  };
}

/** POST the consume route addressed at `workspaceId`, as `role`. */
async function consumeAs(
  role: Role,
  workspaceId = CONTAINER,
  kind: "standard" | "link" = "link"
) {
  mockRepo.findWorkspaceById.mockResolvedValue(workspace(workspaceId, kind));
  mockRepo.findMembership.mockResolvedValue(membership(workspaceId, role));
  const res = await POST(
    new NextRequest("http://localhost/api/mcp/credits/consume", {
      method: "POST",
      headers: { "x-workspace-id": workspaceId },
    }),
    { params: Promise.resolve({}) }
  );
  return { res, body: await res.json() };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  state.userId = GUEST;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mockRepo.findActiveOwnerUserId.mockResolvedValue(OWNER);
  mockRepo.findSoleOwnedStandardWorkspace.mockResolvedValue({
    workspace: workspace(OWNER_WS, "standard"),
    count: 1,
  });
  mockBilling.getWorkspaceBilling.mockResolvedValue(null);
  mockBilling.countActiveMembers.mockResolvedValue(1);
  mockBilling.consumeWorkspaceCredits.mockResolvedValue({
    allowed: true,
    used: 3,
  });
});

afterEach(() => {
  warn.mockRestore();
});

describe("POST /api/mcp/credits/consume — a guest is metered, not refused", () => {
  it("1. accepts a GUEST-scoped call (the viewer default used to 403 it)", async () => {
    const { res, body } = await consumeAs("guest");
    expect(res.status).toBe(200);
    // ⚠ Not just "not 403": a 403 body would still be JSON. Name the code that
    // WAS returned, so a future refusal cannot pass as a shape change.
    expect(body.error).toBeUndefined();
    expect(body.allowed).toBe(true);
  });

  it("2. charges the CONTAINER OWNER's workspace — not the guest's, not the container", async () => {
    await consumeAs("guest");

    expect(mockRepo.findActiveOwnerUserId).toHaveBeenCalledWith(CONTAINER);
    // ⚠ THE LOAD-BEARING ASSERTION. The pre-fix code asked for the CALLER's
    // default workspace; asserting only "the RPC ran" stayed green through that.
    expect(mockRepo.findSoleOwnedStandardWorkspace).toHaveBeenCalledWith(OWNER);
    expect(mockRepo.findSoleOwnedStandardWorkspace).not.toHaveBeenCalledWith(GUEST);
    expect(mockBilling.consumeWorkspaceCredits).toHaveBeenCalledWith(
      OWNER_WS,
      expect.any(String),
      1,
      expect.any(Number)
    );
    expect(mockBilling.consumeWorkspaceCredits).not.toHaveBeenCalledWith(
      CONTAINER,
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("2b. a guest who owns a workspace of their own still does not pay for it", async () => {
    // The guest is not workspace-less — the reroute must pick the OWNER anyway,
    // which is the case a "does it fall back to the caller" bug reads as fine.
    mockRepo.findSoleOwnedStandardWorkspace.mockImplementation(async (userId) => ({
      workspace:
        userId === OWNER
          ? workspace(OWNER_WS, "standard")
          : workspace(GUEST_WS, "standard"),
      count: 1,
    }));
    await consumeAs("guest");
    expect(mockBilling.consumeWorkspaceCredits).toHaveBeenCalledWith(
      OWNER_WS,
      expect.any(String),
      1,
      expect.any(Number)
    );
    expect(mockBilling.consumeWorkspaceCredits).not.toHaveBeenCalledWith(
      GUEST_WS,
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("3. the OWNER's own call in their own container is unchanged", async () => {
    state.userId = OWNER;
    const { res } = await consumeAs("owner");
    expect(res.status).toBe(200);
    expect(mockBilling.consumeWorkspaceCredits).toHaveBeenCalledWith(
      OWNER_WS,
      expect.any(String),
      1,
      expect.any(Number)
    );
  });

  it("3b. a STANDARD workspace still bills itself, asking nobody who owns it", async () => {
    const { res } = await consumeAs("member", OWNER_WS, "standard");
    expect(res.status).toBe(200);
    expect(mockRepo.findActiveOwnerUserId).not.toHaveBeenCalled();
    expect(mockRepo.findSoleOwnedStandardWorkspace).not.toHaveBeenCalled();
    expect(mockBilling.consumeWorkspaceCredits).toHaveBeenCalledWith(
      OWNER_WS,
      expect.any(String),
      1,
      expect.any(Number)
    );
  });
});

describe("the owner has no billing workspace — fail OPEN, and say so", () => {
  it("4. allowed + stamped degraded, nothing charged anywhere", async () => {
    mockRepo.findSoleOwnedStandardWorkspace.mockResolvedValue({
      workspace: null,
      count: 0,
    });
    const { res, body } = await consumeAs("guest");

    expect(res.status).toBe(200);
    expect(body.allowed).toBe(true);
    expect(body).toMatchObject({ used: 0, limit: 0, remaining: 0, degraded: true });
    expect(mockBilling.consumeWorkspaceCredits).not.toHaveBeenCalled();
    expect(mockBilling.getWorkspaceBilling).not.toHaveBeenCalled();
  });

  it("4b. LOGS the reason — silence here is indistinguishable from the bug", async () => {
    mockRepo.findSoleOwnedStandardWorkspace.mockResolvedValue({
      workspace: null,
      count: 0,
    });
    await consumeAs("guest");

    // Assert the CONTENT, not that something was logged: the reason and the
    // payer are what make the line actionable when a guardrail is written.
    const line = warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(line).toContain("container-owner-has-no-billing-workspace");
    expect(line).toContain(CONTAINER);
    expect(line).toContain(GUEST);
    expect(line).toContain(OWNER);
  });

  it("4c. a container with no active owner is its own logged reason", async () => {
    // Unreachable while `20260720184806_workspace_last_active_owner_guard.sql`
    // holds (a workspace cannot lose its last active owner) — asserted so the
    // branch answers unmetered-and-logged rather than throwing if it ever is.
    mockRepo.findActiveOwnerUserId.mockResolvedValue(null);
    const { res, body } = await consumeAs("guest");

    expect(res.status).toBe(200);
    expect(body.degraded).toBe(true);
    expect(mockRepo.findSoleOwnedStandardWorkspace).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n")).toContain(
      "container-has-no-active-owner"
    );
  });
});

describe("the floor is the only thing that changed — everything else still refuses", () => {
  it("a NON-MEMBER is still 404, not billed", async () => {
    mockRepo.findWorkspaceById.mockResolvedValue(workspace(CONTAINER, "link"));
    mockRepo.findMembership.mockResolvedValue(null);
    const res = await POST(
      new NextRequest("http://localhost/api/mcp/credits/consume", {
        method: "POST",
        headers: { "x-workspace-id": CONTAINER },
      }),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(404);
    expect(mockBilling.consumeWorkspaceCredits).not.toHaveBeenCalled();
  });

  it("a non-UUID workspace header is still 400 WORKSPACE_INVALID", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/mcp/credits/consume", {
        method: "POST",
        headers: { "x-workspace-id": "my-slug" },
      }),
      { params: Promise.resolve({}) }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("WORKSPACE_INVALID");
  });
});
