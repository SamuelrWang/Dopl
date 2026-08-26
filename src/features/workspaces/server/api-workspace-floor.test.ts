/**
 * 🔒 THE SECOND WRAPPER FAMILY IS FAIL-CLOSED TOO (2026-08-26).
 *
 * INVARIANTS §4A used to rest the whole guest story on *"`withWorkspaceAuth`
 * defaults `minRole` to viewer, so every workspace-scoped route rejects a guest
 * by default"*. That covers ONE wrapper. The nineteen routes under
 * `src/app/api/workspaces/**` are `withUserAuth` + `segment.ts ›
 * resolveApiWorkspace` / `resolveApiWorkspaceAccess`, which proved membership
 * EXISTENCE (`status='active'`), READ the role, and never COMPARED it.
 *
 * Verified guest-reachable before this change, and every one of them is a route
 * §4A explicitly named as rejecting guests:
 *   - `GET /api/workspaces/[slug]/members`  — the full roster, WITH emails
 *   - `GET /api/workspaces/[slug]/overview` — workspace-wide counts
 *   - `GET /api/workspaces/[slug]/overview-series` — 31 days of activity volume
 *     across EVERY channel in the container, with no channel fence at all on the
 *     unscoped path
 *   - `GET /api/workspaces/[slug]`          — the workspace record + own role
 *   - `GET /api/workspaces/[slug]/my-access` — the teams-mode resource inventory
 *
 * ⚠ THE FIX IS AT THE RESOLVER, NOT AT FIVE ROUTES, so the NEXT route added to
 * this family inherits it. `guest-route-floor.test.ts` set C scans the callers
 * for an explicit opt-down; this file drives the resolver itself, because §14's
 * rule is that a pin on the callers is not a pin on the fence.
 *
 * ⚠ MUTATION-VERIFY: deleting the `meetsMinRole` line in
 * `resolveApiWorkspaceAccess` turns the guest cases red and leaves every other
 * role green.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role, Workspace } from "../types";

vi.mock("./service", () => ({
  findWorkspaceForMemberByPublicId: vi.fn(),
  findWorkspaceForMember: vi.fn(),
  resolveMembershipOrThrow: vi.fn(),
  ensureDefaultWorkspace: vi.fn(),
}));
vi.mock("@/features/analytics/server/system-events", () => ({
  logSystemEvent: vi.fn(),
}));
vi.mock("@/features/onboarding/server/service", () => ({
  getOnboardingStatus: vi.fn(),
}));
vi.mock("@/features/teams/server/access", () => ({
  listEffectiveAccess: vi.fn(),
  toMyAccessPayload: vi.fn(),
}));

import {
  resolveApiWorkspace,
  resolveApiWorkspaceAccess,
} from "./segment";
import { findWorkspaceForMemberByPublicId, findWorkspaceForMember } from "./service";

const USER = "22222222-2222-4222-8222-222222222222";

const WORKSPACE = {
  id: "33333333-3333-4333-8333-333333333333",
  slug: "acme",
  publicId: "abc123def456",
} as Workspace;

/** The canonical `{slug}-{publicId}` segment, so the publicId branch resolves. */
const SEGMENT = "acme-abc123def456";

function memberAt(role: Role) {
  vi.mocked(findWorkspaceForMemberByPublicId).mockResolvedValue({
    workspace: WORKSPACE,
    role,
    userId: USER,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findWorkspaceForMember).mockResolvedValue(null as never);
});

describe("resolveApiWorkspaceAccess — the inverted viewer default", () => {
  it.each(["viewer", "member", "admin", "owner"] as const)(
    "resolves for a %s (nothing changed for anybody above the floor)",
    async (role) => {
      memberAt(role);
      const resolved = await resolveApiWorkspaceAccess(SEGMENT, USER);
      expect(resolved?.workspace.id).toBe(WORKSPACE.id);
      expect(resolved?.role).toBe(role);
    }
  );

  it("REFUSES a guest — the roster, both overviews, the record and my-access all close at once", async () => {
    memberAt("guest");
    expect(await resolveApiWorkspaceAccess(SEGMENT, USER)).toBeNull();
  });

  it("refuses a guest through the plain resolver too", async () => {
    memberAt("guest");
    expect(await resolveApiWorkspace(SEGMENT, USER)).toBeNull();
  });

  it("answers NULL → the caller's own 404, never a new 403 shape", async () => {
    // Every route in the family already maps `null` to "Workspace not found" —
    // the answer a NON-member gets — so a guest cannot use the refusal to learn
    // the workspace exists, and no route grows an error shape.
    memberAt("guest");
    expect(await resolveApiWorkspaceAccess(SEGMENT, USER)).toBeNull();
    memberAt("viewer");
    expect(await resolveApiWorkspaceAccess(SEGMENT, USER)).not.toBeNull();
  });

  it("honours an explicit floor ABOVE the default", async () => {
    memberAt("member");
    expect(await resolveApiWorkspaceAccess(SEGMENT, USER, { minRole: "admin" })).toBeNull();
    memberAt("admin");
    expect(
      (await resolveApiWorkspaceAccess(SEGMENT, USER, { minRole: "admin" }))?.role
    ).toBe("admin");
  });

  it("honours an explicit opt-DOWN to guest — the door a future guest surface would use", async () => {
    // Nothing in this family opts down today (`guest-route-floor.test.ts` set C
    // pins that the allowlist is empty). The door exists so a deliberate future
    // opt-down is a visible edit rather than a resolver rewrite.
    memberAt("guest");
    expect(
      (await resolveApiWorkspaceAccess(SEGMENT, USER, { minRole: "guest" }))?.role
    ).toBe("guest");
  });

  it("still answers NULL for a non-member, ahead of any role question", async () => {
    vi.mocked(findWorkspaceForMemberByPublicId).mockResolvedValue(null as never);
    expect(await resolveApiWorkspaceAccess(SEGMENT, USER)).toBeNull();
  });
});
