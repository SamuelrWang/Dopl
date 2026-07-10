import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { parseSegment } from "@/shared/lib/url/parse-segment";
import type { Workspace } from "../types";
import { workspaceSegment } from "../url";
import {
  findWorkspaceForMember,
  findWorkspaceForMemberByPublicId,
} from "./service";

export interface ResolvedWorkspaceSegment {
  workspace: Workspace;
  /** The canonical `{slug}-{publicId}` segment for this workspace. */
  canonical: string;
  /** True when the inbound segment didn't match canonical — caller should 301. */
  needsRedirect: boolean;
}

/**
 * Resolve a `{workspaceSlug}` URL parameter into a workspace, accepting
 * both the canonical `{slug}-{publicId}` form and legacy slug-only URLs.
 *
 * Lookup order:
 *   1. If the segment parses as `{slug}-{publicId}`, look up by publicId.
 *      Authz is membership-scoped — non-members get null (404).
 *   2. Otherwise, fall back to membership-by-slug. The legacy slug-only
 *      path lives until the `legacy_slug_redirect` system event drops
 *      to zero hits over 14 days; tracked in
 *      [docs/REFACTOR-FINDINGS.md] as a deletion follow-up.
 *
 * Returns null when neither path resolves. Callers are responsible for
 * the 301 / 404 / render decision based on `needsRedirect`.
 */
export const resolveWorkspaceSegmentForUser = cache(
  async (
    segment: string,
    userId: string
  ): Promise<ResolvedWorkspaceSegment | null> => {
  const parsed = parseSegment(segment);
  if (parsed) {
    const workspace = await findWorkspaceForMemberByPublicId(
      userId,
      parsed.publicId
    );
    if (workspace) {
      const canonical = workspaceSegment(workspace);
      return {
        workspace,
        canonical,
        needsRedirect: segment !== canonical,
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
      fingerprintKeys: ["legacy_slug_redirect", legacy.publicId],
      metadata: { workspace_id: legacy.id, slug: segment },
      userId,
    });
    return {
      workspace: legacy,
      canonical: workspaceSegment(legacy),
      needsRedirect: true,
    };
  }
  return null;
  }
);

/**
 * Page-level wrapper around `resolveWorkspaceSegmentForUser`. 404s when
 * no workspace is reachable, 301s to the canonical URL when the inbound
 * segment is stale, otherwise returns the resolved workspace.
 *
 * `tail` lets canvas / knowledge / skills pages preserve their deeper
 * segment when redirecting (e.g. `/old-slug/main` → `/new-canonical/main`).
 */
export async function resolvePageWorkspace(
  segment: string,
  userId: string,
  tail: string = ""
): Promise<Workspace> {
  const resolved = await resolveWorkspaceSegmentForUser(segment, userId);
  if (!resolved) notFound();
  if (resolved.needsRedirect) {
    const suffix = tail ? `/${tail}` : "";
    redirect(`/${resolved.canonical}${suffix}`);
  }
  return resolved.workspace;
}

/**
 * API-route wrapper. Returns the workspace if reachable, null otherwise.
 * Does NOT 301 on stale segment — clients of API routes can keep using
 * legacy slugs through the deletion window without their fetch
 * promotion semantics changing (a 301 on POST would degrade to GET).
 */
export async function resolveApiWorkspace(
  segment: string,
  userId: string
): Promise<Workspace | null> {
  const resolved = await resolveWorkspaceSegmentForUser(segment, userId);
  return resolved?.workspace ?? null;
}
