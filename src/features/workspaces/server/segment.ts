import "server-only";
import { cache } from "react";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { getOnboardingStatus } from "@/features/onboarding/server/service";
import {
  listEffectiveAccess,
  toMyAccessPayload,
  type MyAccessPayload,
} from "@/features/teams/server/access";
import { parseSegment } from "@/shared/lib/url/parse-segment";
import { meetsMinRole, type Role, type Workspace } from "../types";
import { workspaceSegment } from "../url";
import {
  ensureDefaultWorkspace,
  findWorkspaceForMember,
  findWorkspaceForMemberByPublicId,
  resolveMembershipOrThrow,
} from "./service";

export interface ResolvedWorkspaceSegment {
  workspace: Workspace;
  /** The canonical `{slug}-{publicId}` segment for this workspace. */
  canonical: string;
  /** Inbound segment didn't match canonical — caller should 301. */
  needsRedirect: boolean;
  /** Caller's role. Free — proving membership already read it. */
  role: Role;
}

export interface ApiWorkspaceOpts {
  /** Floor the caller's membership must clear. Default `"viewer"` — the same
   *  inverted default `withWorkspaceAuth` carries, so `guest` is refused unless
   *  a caller says otherwise. */
  minRole?: Role;
}

/**
 * ⚠ THE UNFLOORED ROOT RESOLVER, AND IT IS MODULE-PRIVATE ON PURPOSE
 * (2026-08-26). It answers "which workspace is this segment, and what is this
 * caller's role in it" and compares NOTHING — every floor in this file is built
 * on top of it. It is exported nowhere, so a new caller cannot reach it without
 * choosing a floor, which is the failure the guest wave found: `getBootState`
 * and `resolveWorkspaceSegmentForUser` both called the root directly while only
 * `resolveApiWorkspaceAccess` had grown the floor.
 *
 * ⚠ `cache()` IS KEYED ON THE ARGUMENTS, which is why the floor is NOT a third
 * parameter here: an options OBJECT is a fresh identity per call, so folding the
 * floor in would defeat the per-request memoization two RSC trees rely on.
 * Floors compose OUTSIDE the cache; the lookup is paid once either way.
 *
 * Resolves the canonical `{slug}-{publicId}` form and legacy slug-only URLs:
 *   1. Parses as `{slug}-{publicId}` → look up by publicId. Membership-scoped,
 *      so non-members get null (404).
 *   2. Else membership-by-slug. Legacy path lives until the
 *      `legacy_slug_redirect` system event hits zero over 14 days
 *      (docs/REFACTOR-FINDINGS.md deletion follow-up).
 */
const resolveSegmentUnfloored = cache(
  async (
    segment: string,
    userId: string
  ): Promise<ResolvedWorkspaceSegment | null> => {
  const parsed = parseSegment(segment);
  if (parsed) {
    const member = await findWorkspaceForMemberByPublicId(
      userId,
      parsed.publicId
    );
    if (member) {
      const canonical = workspaceSegment(member.workspace);
      return {
        workspace: member.workspace,
        canonical,
        needsRedirect: segment !== canonical,
        role: member.role,
      };
    }
  }

  const legacy = await findWorkspaceForMember(userId, segment);
  if (legacy) {
    void logSystemEvent({
      severity: "info",
      category: "other",
      source: "legacy_slug_redirect",
      message: `Legacy slug URL hit: ${segment}`,
      fingerprintKeys: ["legacy_slug_redirect", legacy.workspace.publicId],
      metadata: { workspace_id: legacy.workspace.id, slug: segment },
      userId,
    });
    return {
      workspace: legacy.workspace,
      canonical: workspaceSegment(legacy.workspace),
      needsRedirect: true,
      role: legacy.role,
    };
  }
  return null;
  }
);

/**
 * Resolve a `{workspaceSlug}` URL parameter into a workspace the caller may
 * reach AT `opts.minRole` — default `"viewer"`, matching both wrapper families.
 * Null when the segment does not resolve, the caller is not a member, OR the
 * caller's role is below the floor; the caller owns the 301 / 404 / render
 * decision via `needsRedirect`.
 *
 * 🔒 ⚠ THE FLOOR MOVED HERE ON 2026-08-26 AND THAT CLOSED A SHAPE, NOT A LEAK.
 * The guest wave floored `resolveApiWorkspaceAccess` and stopped there, but
 * THREE call sites reach the same lookup without going through it —
 * `GET /api/workspaces/resolve`, `src/app/billing/[segment]/page.tsx` and
 * `getBootState` (`POST /api/boot`) — so the family was fail-closed at one door
 * and unfloored at the others. Nothing live leaked (see `getBootState`), and a
 * fence with three doors and one lock is a bug whether or not anybody walked
 * through it.
 */
export async function resolveWorkspaceSegmentForUser(
  segment: string,
  userId: string,
  opts: ApiWorkspaceOpts = {}
): Promise<ResolvedWorkspaceSegment | null> {
  const resolved = await resolveSegmentUnfloored(segment, userId);
  if (!resolved) return null;
  // ⚠ ONE STATEMENT OF THE FLOOR, for both families. `guest-route-floor.test.ts`
  // set C reads this exact line — §14's "a pin on the callers is not a pin on
  // the fence".
  if (!meetsMinRole(resolved.role, opts.minRole ?? "viewer")) return null;
  return resolved;
}

/**
 * 🔒 THE SECOND WRAPPER FAMILY'S ROLE FLOOR, AND IT IS INVERTED-DEFAULT LIKE THE
 * FIRST ONE'S (2026-08-26).
 *
 * ⚠ WHAT THIS FIXES. INVARIANTS §4A used to rest the whole guest story on
 * *"`withWorkspaceAuth` defaults `minRole` to viewer, so every workspace-scoped
 * route rejects a guest by default"*. That covers ONE wrapper. The routes under
 * `src/app/api/workspaces/**` are `withUserAuth` + these two resolvers, which
 * proved membership EXISTENCE (`status = 'active'`) and read the role WITHOUT
 * EVER COMPARING IT — so a guest reached the full member roster (with every
 * member's email), both overview reads, the workspace record and `my-access`,
 * all of which §4A explicitly named as rejecting guests. Blast radius was
 * bounded (a guest's only workspace is their two-person container) and the
 * SHAPE was not: nothing stopped the next route added here from admitting one.
 *
 * ⚠ SO THE DEFAULT IS `"viewer"`, MATCHING `withWorkspaceAuth`. A route that
 * genuinely wants a guest opts DOWN explicitly, exactly as a channel route does,
 * and `src/app/api/channels/guest-route-floor.test.ts` scans THIS family too so
 * an opt-down cannot be silent.
 *
 * ⚠ AND THE FLOOR IS NOT HERE ANY MORE — IT IS ON `resolveWorkspaceSegmentForUser`
 * (2026-08-26, second pass). These two wrappers were the only floored door;
 * `GET /api/workspaces/resolve`, `src/app/billing/[segment]/page.tsx` and
 * `getBootState` reach the same lookup directly and inherited nothing. The
 * comparison moved DOWN one level so all four share one statement, and boot
 * opts down explicitly. `resolveApiWorkspaceAccess` now only threads `opts`.
 *
 * ⚠ A REFUSAL IS `null` → 404, NOT 403. Every caller already maps `null` to
 * "Workspace not found", which is the answer a non-member gets — so a guest
 * cannot use the refusal to learn that the workspace exists, and no route grows
 * a new error shape.
 */
/**
 * API-route wrapper: workspace if reachable AT `opts.minRole` (default
 * `"viewer"`), else null. ⚠ Does NOT 301 on a stale segment — a 301 on POST
 * degrades to GET, so API clients keep using legacy slugs through the deletion
 * window.
 */
export async function resolveApiWorkspace(
  segment: string,
  userId: string,
  opts: ApiWorkspaceOpts = {}
): Promise<Workspace | null> {
  return (await resolveApiWorkspaceAccess(segment, userId, opts))?.workspace ?? null;
}

/**
 * Same lookup, keeping the `role` the resolve already read, for routes that
 * would otherwise re-fetch the membership. Thread it into
 * `listEffectiveAccess` / `effectiveResourceAccess` via `opts.role` rather than
 * letting them re-query.
 */
export async function resolveApiWorkspaceAccess(
  segment: string,
  userId: string,
  opts: ApiWorkspaceOpts = {}
): Promise<{ workspace: Workspace; role: Role } | null> {
  // ⚠ The floor is NOT restated here — it lives in
  // `resolveWorkspaceSegmentForUser`, which every direct caller now shares. A
  // second copy is a second thing to drift.
  const resolved = await resolveWorkspaceSegmentForUser(segment, userId, opts);
  if (!resolved) return null;
  return { workspace: resolved.workspace, role: resolved.role };
}

/**
 * THE BOOT ANSWER — everything the bundled SPA needs before it can render, in
 * one round trip (`POST /api/boot`). Replaces a serial chain of four
 * (`onboarding-state` → `ensure-default` → `resolve` → `me`, + `my-access`).
 *
 * TWO MODES, and the difference is the fail-closed rule (ENGINEERING §9
 * "Workspace resolution"):
 *   - `segment` GIVEN (shell, deep link) — resolve it and nothing else.
 *     Membership-scoped, so "not a member" and "does not exist" both arrive as
 *     `null` → plain 404. ⚠ NEVER falls back to a default workspace; a boot
 *     endpoint that guesses is a cross-tenant bug.
 *   - `segment` ABSENT (cold launch at `/`) — the PROVISIONING path:
 *     `ensureDefaultWorkspace`, idempotent, always 200. ⚠ Gated on onboarding —
 *     an un-onboarded caller must not have a workspace provisioned underneath
 *     them, so that branch returns a null workspace and the SPA routes to
 *     `/onboarding`.
 *
 * ⚠ Membership is proven server-side in BOTH modes
 * (`resolveWorkspaceSegmentForUser` / `resolveMembershipOrThrow`) before
 * `role`, `userId` or `myAccess` is computed. The client is told what it may
 * see; it never asserts it.
 */
export interface BootState {
  isOnboarded: boolean;
  surveyCompleted: boolean;
  userId: string;
  workspace: Workspace | null;
  /** Canonical `{slug}-{publicId}`. Null only when there is no workspace. */
  segment: string | null;
  /** Segment mode only: the routed segment was stale — rewrite the URL. */
  needsRedirect: boolean;
  role: Role | null;
  myAccess: MyAccessPayload | null;
}

/**
 * 🔒 ⚠ BOOT IS THE ONE DOCUMENTED GUEST EXEMPTION IN THIS FILE, AND IT IS
 * DELIBERATE (2026-08-26). Every other caller of the segment resolver inherits
 * the `viewer` default; this one opts DOWN explicitly, exactly as a channel
 * route does.
 *
 * WHY, MEASURED against the tree rather than assumed: `POST /api/boot` is not a
 * capability, it is "which workspace is this URL and who am I in it". The SPA's
 * `use-workspace-route.ts › useWorkspaceRoute` is the only reader of the SEGMENT
 * mode, and it mounts for `/:workspaceSegment/thread-window/:channelId` and
 * `/:workspaceSegment/agent-window/:channelId` — the two pop-out windows, which
 * live OUTSIDE `AppShellLayout` and pay this read themselves. A guest who has
 * the desktop app pops a thread out of their home channel and the routed segment
 * IS the link container's. A `viewer` floor here would answer 404 and the window
 * would render "Workspace not found" — the exact class of break M1 shipped when
 * it floored the wrong mentions verb, and the exact rule §4A states as **THE
 * SURFACE MUST NOT ISSUE A REQUEST IT WILL GET 403 ON**.
 *
 * AND IT GRANTS NOTHING THE GUEST DOES NOT ALREADY HAVE: the `Workspace` record
 * is by-contract reachable through the unfiltered `GET /api/workspaces` (§4A),
 * `role` is the caller's own, `segment`/`needsRedirect` are URL facts, and
 * onboarding status is per-user. The one payload that IS a capability inventory
 * — `myAccess` — carries its own floor, below.
 */
const BOOT_MIN_ROLE: Role = "guest";

/** `null` = the requested segment did not resolve; the route 404s. */
export async function getBootState(
  userId: string,
  segment: string | null
): Promise<BootState | null> {
  if (segment) {
    // Independent of the workspace read, so it rides along free.
    const [status, resolved] = await Promise.all([
      getOnboardingStatus(userId),
      resolveWorkspaceSegmentForUser(segment, userId, { minRole: BOOT_MIN_ROLE }),
    ]);
    if (!resolved) return null;
    return {
      isOnboarded: status.onboarded,
      surveyCompleted: status.surveyCompleted,
      userId,
      workspace: resolved.workspace,
      segment: resolved.canonical,
      needsRedirect: resolved.needsRedirect,
      role: resolved.role,
      myAccess: await myAccessFor(resolved.workspace.id, userId, resolved.role),
    };
  }

  const status = await getOnboardingStatus(userId);
  if (!status.onboarded) {
    // ⚠ NO PROVISIONING BEFORE ONBOARDING — the boot page's
    // `enabled: signedIn && onboarded` gate, moved server-side.
    return {
      isOnboarded: false,
      surveyCompleted: status.surveyCompleted,
      userId,
      workspace: null,
      segment: null,
      needsRedirect: false,
      role: null,
      myAccess: null,
    };
  }

  const workspace = await ensureDefaultWorkspace(userId);
  // ⚠ Fail-closed even on the workspace just ensured: a revoked owner has no
  // active membership and must get the same 404.
  const { membership } = await resolveMembershipOrThrow(workspace.id, userId);
  return {
    isOnboarded: true,
    surveyCompleted: status.surveyCompleted,
    userId,
    workspace,
    segment: workspaceSegment(workspace),
    needsRedirect: false,
    role: membership.role,
    myAccess: await myAccessFor(workspace.id, userId, membership.role),
  };
}

/**
 * 🔒 THE PROJECTION'S OWN FLOOR, AND IT EXISTS BECAUSE THIS PROJECTION HAS A
 * TWIN (2026-08-26). `my-access/route.ts` says of it: *"shared with POST
 * /api/boot … they must not drift"* — and the guest wave floored the twin (that
 * route is in the `resolveApiWorkspace` family, now `viewer`+) and not this one.
 *
 * ⚠ THE DRIFT WAS SHAPE, NOT DATA: today `teams/server/access.ts ›
 * listEffectiveAccess` already answers `null` for a guest, because
 * `defaultLevelForRole("guest")` is `null` and a role with no default level
 * reaches no shareable resource. So boot's `myAccess` was `null` for a guest by
 * ACCIDENT of an access-level table, one edit away from enumerating every
 * teams-mode resource id to a link claimer. Stating the floor here makes the two
 * twins say the same thing for the same reason.
 */
const MY_ACCESS_MIN_ROLE: Role = "viewer";

/** The `my-access` payload, computed from a role we already hold. */
async function myAccessFor(
  workspaceId: string,
  userId: string,
  role: Role
): Promise<MyAccessPayload | null> {
  if (!meetsMinRole(role, MY_ACCESS_MIN_ROLE)) return null;
  const result = await listEffectiveAccess(workspaceId, userId, { role });
  return result ? toMyAccessPayload(result) : null;
}
