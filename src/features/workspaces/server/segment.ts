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
import type { Role, Workspace } from "../types";
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

/**
 * Resolve a `{workspaceSlug}` URL parameter into a workspace, accepting the
 * canonical `{slug}-{publicId}` form and legacy slug-only URLs.
 *   1. Parses as `{slug}-{publicId}` → look up by publicId. Membership-scoped,
 *      so non-members get null (404).
 *   2. Else membership-by-slug. Legacy path lives until the
 *      `legacy_slug_redirect` system event hits zero over 14 days
 *      (docs/REFACTOR-FINDINGS.md deletion follow-up).
 *
 * Null when neither resolves; caller owns the 301 / 404 / render decision via
 * `needsRedirect`.
 */
export const resolveWorkspaceSegmentForUser = cache(
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
 * API-route wrapper: workspace if reachable, else null. ⚠ Does NOT 301 on a
 * stale segment — a 301 on POST degrades to GET, so API clients keep using
 * legacy slugs through the deletion window.
 */
export async function resolveApiWorkspace(
  segment: string,
  userId: string
): Promise<Workspace | null> {
  const resolved = await resolveWorkspaceSegmentForUser(segment, userId);
  return resolved?.workspace ?? null;
}

/**
 * Same lookup, keeping the `role` the resolve already read, for routes that
 * would otherwise re-fetch the membership. Thread it into
 * `listEffectiveAccess` / `effectiveResourceAccess` via `opts.role` rather than
 * letting them re-query.
 */
export async function resolveApiWorkspaceAccess(
  segment: string,
  userId: string
): Promise<{ workspace: Workspace; role: Role } | null> {
  const resolved = await resolveWorkspaceSegmentForUser(segment, userId);
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

/** `null` = the requested segment did not resolve; the route 404s. */
export async function getBootState(
  userId: string,
  segment: string | null
): Promise<BootState | null> {
  if (segment) {
    // Independent of the workspace read, so it rides along free.
    const [status, resolved] = await Promise.all([
      getOnboardingStatus(userId),
      resolveWorkspaceSegmentForUser(segment, userId),
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

/** The `my-access` payload, computed from a role we already hold. */
async function myAccessFor(
  workspaceId: string,
  userId: string,
  role: Role
): Promise<MyAccessPayload | null> {
  const result = await listEffectiveAccess(workspaceId, userId, { role });
  return result ? toMyAccessPayload(result) : null;
}
