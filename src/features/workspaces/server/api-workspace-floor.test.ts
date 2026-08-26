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
 * 🔒 ⚠ AND THE FIRST PASS FLOORED ONE DOOR OF THREE (corrected 2026-08-26).
 * `resolveApiWorkspaceAccess` was NOT the only way into this lookup: three call
 * sites reached the un-floored root resolver directly —
 *   - `getBootState` (`POST /api/boot`), which then runs `myAccessFor` →
 *     `listEffectiveAccess` → `toMyAccessPayload`, the SAME projection
 *     `my-access/route.ts` documents as *"shared with POST /api/boot … they must
 *     not drift"*;
 *   - `GET /api/workspaces/resolve`;
 *   - `src/app/billing/[segment]/page.tsx`.
 * Set C could not see it (none of them names `resolveApiWorkspace`) and this
 * file did not drive `getBootState`. **Nothing live leaked** — a guest's
 * `myAccess` was already `null` because `defaultLevelForRole("guest")` is
 * `null`, and the `Workspace` record is by-contract guest-reachable through the
 * unfiltered `GET /api/workspaces` (§4A) — so this is a SHAPE fix, and the
 * accident that covered it was one edit to an access-level table wide.
 *
 * THE FLOOR THEREFORE MOVED DOWN to `resolveWorkspaceSegmentForUser`, which all
 * four share, and TWO DECISIONS ARE PINNED BELOW rather than inherited:
 *   1. **BOOT IS AN EXPLICIT `guest` EXEMPTION** — the SPA's two pop-out windows
 *      (`/:workspaceSegment/thread-window|agent-window/:channelId`) pay this read
 *      themselves, and a guest popping a thread out of their home channel routes
 *      the CONTAINER's segment. A `viewer` floor answers 404 and the window
 *      renders "Workspace not found" — §4A's *the surface must not issue a
 *      request it will get 403 on*, which is the bug M1 shipped.
 *   2. **`myAccess` KEEPS THE `viewer` FLOOR ANYWAY**, stated at
 *      `MY_ACCESS_MIN_ROLE`, so the exemption covers workspace IDENTITY and
 *      never the capability inventory its twin route refuses.
 *
 * ⚠ MUTATION-VERIFY (measured 2026-08-26 — 3 reverts, 3 failures, 0 vacuous):
 * deleting the `meetsMinRole` line in `resolveWorkspaceSegmentForUser`; changing
 * `BOOT_MIN_ROLE` to `"viewer"`; deleting the `MY_ACCESS_MIN_ROLE` guard.
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
  getBootState,
  resolveApiWorkspace,
  resolveApiWorkspaceAccess,
  resolveWorkspaceSegmentForUser,
} from "./segment";
import { findWorkspaceForMemberByPublicId, findWorkspaceForMember } from "./service";
import { getOnboardingStatus } from "@/features/onboarding/server/service";
import { listEffectiveAccess, toMyAccessPayload } from "@/features/teams/server/access";

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

describe("resolveWorkspaceSegmentForUser — the floor is on the ROOT, not on one wrapper", () => {
  // The three direct callers (`GET /api/workspaces/resolve`,
  // `billing/[segment]/page.tsx`, `getBootState`) all reach THIS function. Two
  // of them pass no options and must therefore be fail-closed.

  it("REFUSES a guest by default — the door `/api/workspaces/resolve` and the billing page use", async () => {
    memberAt("guest");
    expect(await resolveWorkspaceSegmentForUser(SEGMENT, USER)).toBeNull();
  });

  it.each(["viewer", "member", "admin", "owner"] as const)(
    "resolves for a %s and still carries the redirect facts",
    async (role) => {
      memberAt(role);
      const resolved = await resolveWorkspaceSegmentForUser(SEGMENT, USER);
      expect(resolved?.role).toBe(role);
      expect(resolved?.canonical).toBe(SEGMENT);
      expect(resolved?.needsRedirect).toBe(false);
    }
  );

  it("honours an explicit opt-down — the door BOOT uses", async () => {
    memberAt("guest");
    expect(
      (await resolveWorkspaceSegmentForUser(SEGMENT, USER, { minRole: "guest" }))?.role
    ).toBe("guest");
  });

  it("honours an explicit floor above the default", async () => {
    memberAt("member");
    expect(
      await resolveWorkspaceSegmentForUser(SEGMENT, USER, { minRole: "admin" })
    ).toBeNull();
  });
});

describe("getBootState — the EXEMPTION is explicit, and it stops at identity", () => {
  beforeEach(() => {
    vi.mocked(getOnboardingStatus).mockResolvedValue({
      onboarded: true,
      surveyCompleted: true,
    } as never);
    // If the floor below ever stops holding, THIS is what a guest would get.
    vi.mocked(listEffectiveAccess).mockResolvedValue({
      defaultLevel: "view",
      isAdmin: false,
      teamsModeResources: [{ resourceType: "knowledge_base", resourceId: "kb-1", level: "view" }],
    } as never);
    vi.mocked(toMyAccessPayload).mockImplementation(((r: unknown) => r) as never);
  });

  it("a GUEST still BOOTS — the pop-out windows resolve their container segment", async () => {
    // ⚠ A `viewer` floor here renders "Workspace not found" in the thread and
    // agent windows for a guest in the desktop app. The exemption is the point.
    memberAt("guest");
    const state = await getBootState(USER, SEGMENT);
    expect(state?.workspace?.id).toBe(WORKSPACE.id);
    expect(state?.role).toBe("guest");
    expect(state?.segment).toBe(SEGMENT);
  });

  it("…and gets NO myAccess, for a STATED reason rather than an accident", async () => {
    // The twin route (`GET …/my-access`) refuses a guest outright; boot must not
    // answer the same projection. `listEffectiveAccess` is mocked to a NON-empty
    // matrix above precisely so a pass cannot come from the real function's
    // `defaultLevelForRole("guest") === null` short-circuit.
    memberAt("guest");
    const state = await getBootState(USER, SEGMENT);
    expect(state?.myAccess).toBeNull();
    expect(listEffectiveAccess).not.toHaveBeenCalled();
  });

  it.each(["viewer", "member", "admin", "owner"] as const)(
    "a %s still gets the matrix (the floor is a floor, not a removal)",
    async (role) => {
      memberAt(role);
      const state = await getBootState(USER, SEGMENT);
      expect(state?.myAccess).not.toBeNull();
    }
  );

  it("a non-member is still NULL → the route's 404, exemption or not", async () => {
    vi.mocked(findWorkspaceForMemberByPublicId).mockResolvedValue(null as never);
    expect(await getBootState(USER, SEGMENT)).toBeNull();
  });
});
