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
 * 🔒 ⚠ THE SECOND DIMENSION IS THE CONTAINER LOCK, AND IT WAS ENFORCED IN ONE OF
 * THE TWO FAMILIES (added 2026-08-26). `with-workspace-auth.ts` 403s a
 * workspace-scoped credential that names another workspace, and
 * `mcp-container-token.ts` claimed of it that *"that credential cannot name
 * another workspace"*. THIS FILE'S FAMILY HAD ZERO REFERENCES TO
 * `apiKeyWorkspaceId`, so the claim was true of one wrapper and false of the
 * other. The reachable walk was:
 *   1. `POST /api/boot` with NO segment — the provisioning branch answers
 *      `ensurePersonalContainer`, i.e. the operator's OWN container id AND its
 *      canonical `{slug}-{publicId}` segment, to any valid credential;
 *   2. that segment into any of the 19 `resolveApiWorkspace` route files —
 *      access-matrix, members-with-emails, overview, overview-series, teams,
 *      invitations, join-link, my-access, member activity.
 * The lock now lives ONCE, beside the role floor, in
 * `resolveWorkspaceSegmentForUser`; boot's no-segment mode refuses a locked
 * caller outright; and the CALLER SCAN below is what stops the next route added
 * to this family from forgetting to thread it.
 *
 * ⚠ MUTATION-VERIFY (role floor, measured 2026-08-26 — 3 reverts, 3 failures,
 * 0 vacuous): deleting the `meetsMinRole` line in
 * `resolveWorkspaceSegmentForUser`; changing `BOOT_MIN_ROLE` to `"viewer"`;
 * deleting the `MY_ACCESS_MIN_ROLE` guard.
 * ⚠ MUTATION-VERIFY (container lock, measured 2026-08-26 — 3 reverts,
 * 3 failures, 0 vacuous): deleting the `withinKeyLock` line in
 * `resolveWorkspaceSegmentForUser`; deleting the `apiKeyWorkspaceId?.trim()`
 * refusal in `getBootState`'s provisioning branch; dropping
 * `{ apiKeyWorkspaceId }` from one route's `resolveApiWorkspace` call.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role, Workspace } from "../types";

vi.mock("./service", () => ({
  findWorkspaceForMemberByPublicId: vi.fn(),
  findWorkspaceForMember: vi.fn(),
  resolveMembershipOrThrow: vi.fn(),
  ensurePersonalContainer: vi.fn(),
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
import {
  findWorkspaceForMemberByPublicId,
  findWorkspaceForMember,
  ensurePersonalContainer,
  resolveMembershipOrThrow,
} from "./service";
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

describe("🔒 the CONTAINER LOCK — the second dimension, and it lives on the resolver", () => {
  it("a locked credential is REFUSED a workspace that is not its own", async () => {
    memberAt("owner");
    expect(
      await resolveWorkspaceSegmentForUser(SEGMENT, USER, {
        apiKeyWorkspaceId: "44444444-4444-4444-8444-444444444444",
      })
    ).toBeNull();
  });

  it("…and the refusal is `null` → the caller's plain 404, not a new error shape", async () => {
    // Every caller in this family already maps `null` to "Workspace not found",
    // which is what a NON-MEMBER gets — so the lock cannot be used to learn that
    // the workspace exists. Asserted through both wrappers, since both must map
    // it the same way.
    memberAt("owner");
    const opts = { apiKeyWorkspaceId: "44444444-4444-4444-8444-444444444444" };
    expect(await resolveApiWorkspace(SEGMENT, USER, opts)).toBeNull();
    expect(await resolveApiWorkspaceAccess(SEGMENT, USER, opts)).toBeNull();
  });

  it("the lock's OWN workspace still resolves — it narrows, it does not close", async () => {
    memberAt("owner");
    const resolved = await resolveWorkspaceSegmentForUser(SEGMENT, USER, {
      apiKeyWorkspaceId: WORKSPACE.id,
    });
    expect(resolved?.workspace.id).toBe(WORKSPACE.id);
  });

  it("an UNLOCKED caller is untouched — null, undefined and blank all mean 'no lock'", async () => {
    // ⚠ Blank-after-trim reads as NO lock, mirroring `with-workspace-auth.ts`'s
    // trim. A storage artefact must not 404 every request a session makes.
    memberAt("viewer");
    for (const apiKeyWorkspaceId of [null, undefined, "   "]) {
      expect(
        (await resolveWorkspaceSegmentForUser(SEGMENT, USER, { apiKeyWorkspaceId }))
          ?.workspace.id
      ).toBe(WORKSPACE.id);
    }
  });

  it("the lock is compared TRIMMED, so a padded column value is not a spurious 404", async () => {
    memberAt("owner");
    expect(
      (await resolveWorkspaceSegmentForUser(SEGMENT, USER, {
        apiKeyWorkspaceId: ` ${WORKSPACE.id} `,
      }))?.workspace.id
    ).toBe(WORKSPACE.id);
  });

  it("the lock beats the ROLE — an owner of the other workspace is still refused", async () => {
    // Ordering matters: the lock runs first precisely so "I am an owner there"
    // is never an argument against it.
    memberAt("owner");
    expect(
      await resolveWorkspaceSegmentForUser(SEGMENT, USER, {
        minRole: "guest",
        apiKeyWorkspaceId: "44444444-4444-4444-8444-444444444444",
      })
    ).toBeNull();
  });
});

describe("🔒 getBootState — the no-segment PROVISIONING mode is closed to a locked credential", () => {
  beforeEach(() => {
    vi.mocked(getOnboardingStatus).mockResolvedValue({
      onboarded: true,
      surveyCompleted: true,
    } as never);
    vi.mocked(ensurePersonalContainer).mockResolvedValue(WORKSPACE as never);
    vi.mocked(resolveMembershipOrThrow).mockResolvedValue({
      membership: { role: "owner" },
    } as never);
  });

  it("a locked caller gets NULL rather than the operator's own container", async () => {
    // THE WALK THIS CLOSES: no segment → the operator's container id + canonical
    // segment → 19 routes. The refusal lands before onboarding is even read.
    expect(
      await getBootState(USER, null, "44444444-4444-4444-8444-444444444444")
    ).toBeNull();
    expect(ensurePersonalContainer).not.toHaveBeenCalled();
  });

  it("an UNLOCKED caller still provisions — the cold-launch path is untouched", async () => {
    const state = await getBootState(USER, null);
    expect(state?.workspace?.id).toBe(WORKSPACE.id);
    expect(ensurePersonalContainer).toHaveBeenCalledTimes(1);
  });

  it("SEGMENT mode with a locked credential naming ANOTHER workspace is 404, not the record", async () => {
    memberAt("owner");
    expect(
      await getBootState(USER, SEGMENT, "44444444-4444-4444-8444-444444444444")
    ).toBeNull();
  });

  it("SEGMENT mode still answers for the LOCKED workspace itself", async () => {
    memberAt("guest");
    const state = await getBootState(USER, SEGMENT, WORKSPACE.id);
    expect(state?.workspace?.id).toBe(WORKSPACE.id);
  });
});

describe("🔒 the CALLER SCAN — every route in the family threads the lock", () => {
  /**
   * ⚠ A PIN ON THE FENCE IS NOT A PIN ON ITS CALLERS, AND HERE BOTH ARE NEEDED
   * (§14). The lock cannot have a fail-closed DEFAULT — the resolver has no way
   * to see a credential nobody handed it, and an ambient it could read would
   * answer "no lock" on a scope miss, i.e. fail OPEN. So the resolver holds the
   * comparison and this scan holds the threading. Reverting either is red.
   */
  const API_ROOT = join(import.meta.dirname, "..", "..", "..", "app", "api");

  function walk(dir: string, into: Array<[string, string]>): Array<[string, string]> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, into);
      else if (entry.name === "route.ts") into.push([full, readFileSync(full, "utf8")]);
    }
    return into;
  }

  /** Route files that resolve a workspace through THIS family. */
  const FAMILY = walk(API_ROOT, []).filter(([, src]) =>
    /resolveApiWorkspace(Access)?\s*\(|resolveWorkspaceSegmentForUser\s*\(|getBootState\s*\(/.test(
      src
    )
  );

  it("finds the family (a rename that empties this list must not pass silently)", () => {
    // ⚠ MEASURED 2026-08-26: 21 route files (19 `resolveApiWorkspace`, plus
    // `workspaces/resolve` and `boot`). Re-derive, never quote:
    //   grep -rln "resolveApiWorkspace\|resolveWorkspaceSegmentForUser\|getBootState" src/app/api
    expect(FAMILY.length).toBeGreaterThanOrEqual(18);
  });

  it("EVERY one of them names apiKeyWorkspaceId", () => {
    const silent = FAMILY.filter(([, src]) => !/apiKeyWorkspaceId/.test(src)).map(
      ([f]) => f.slice(f.indexOf("src/"))
    );
    expect(silent).toEqual([]);
  });

  it("every RESOLVE CALL in them passes it — naming the field is not threading it", () => {
    const unthreaded: string[] = [];
    for (const [file, src] of FAMILY) {
      const calls = src.match(
        /(?:resolveApiWorkspace(?:Access)?|resolveWorkspaceSegmentForUser|getBootState)\s*\([\s\S]*?\)\s*;/g
      );
      for (const call of calls ?? []) {
        if (!/apiKeyWorkspaceId/.test(call)) {
          unthreaded.push(`${file.slice(file.indexOf("src/"))}: ${call.slice(0, 60)}`);
        }
      }
    }
    expect(unthreaded).toEqual([]);
  });

  it("the resolver itself still HOLDS the comparison (read the fence, not its callers)", () => {
    const segment = readFileSync(join(import.meta.dirname, "segment.ts"), "utf8");
    expect(segment).toMatch(
      /if \(!withinKeyLock\(resolved\.workspace\.id, opts\.apiKeyWorkspaceId\)\) return null;/
    );
    // …and boot's provisioning branch holds its own, because that branch never
    // reaches the resolver at all.
    expect(segment).toMatch(/if \(apiKeyWorkspaceId\?\.trim\(\)\) return null;/);
  });
});
