import "server-only";
import { notFound, redirect } from "next/navigation";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { parseSegment } from "@/shared/lib/url/parse-segment";
import { workspaceSegment } from "@/features/workspaces/url";
import type { Skill, SkillContext } from "../types";
import { skillSegment } from "../url";
import * as repo from "./repository";

export interface ResolvedSkillSegment {
  skill: Skill;
  /** Canonical `{slug}-{publicId}` segment for this skill. */
  canonical: string;
  /** True when the inbound segment didn't match canonical — caller should 301. */
  needsRedirect: boolean;
}

/**
 * Resolve a `{skillSlug}` URL parameter into a skill. Accepts the
 * canonical `{slug}-{publicId}` form and legacy slug-only URLs.
 *
 * Slug uniqueness within workspace is enforced at the DB layer because
 * MCP tools address skills by slug — the legacy fallback remains a
 * deterministic single-row lookup.
 */
export async function resolveSkillSegmentForCtx(
  ctx: SkillContext,
  segment: string
): Promise<ResolvedSkillSegment | null> {
  const parsed = parseSegment(segment);
  if (parsed) {
    const skill = await repo.findSkillByPublicId(
      ctx.workspaceId,
      parsed.publicId
    );
    if (skill) {
      const canonical = skillSegment(skill);
      return { skill, canonical, needsRedirect: segment !== canonical };
    }
  }
  const legacy = await repo.findSkillBySlug(ctx.workspaceId, segment);
  if (legacy) {
    void logSystemEvent({
      severity: "info",
      category: "other",
      source: "legacy_slug_redirect",
      message: `Legacy skill slug URL hit: ${segment}`,
      fingerprintKeys: ["legacy_slug_redirect", "skill", legacy.publicId],
      metadata: {
        workspace_id: ctx.workspaceId,
        skill_id: legacy.id,
        slug: segment,
      },
      userId: ctx.userId,
    });
    return {
      skill: legacy,
      canonical: skillSegment(legacy),
      needsRedirect: true,
    };
  }
  return null;
}

/**
 * Page-level wrapper. 404 on miss, 301 on stale segment, otherwise
 * returns the resolved skill. Takes the workspace shape so we can
 * assemble the canonical redirect URL at both levels.
 */
export async function resolvePageSkill(
  ctx: SkillContext,
  workspace: { slug: string; publicId: string },
  segment: string
): Promise<Skill> {
  const resolved = await resolveSkillSegmentForCtx(ctx, segment);
  if (!resolved) notFound();
  if (resolved.needsRedirect) {
    redirect(`/${workspaceSegment(workspace)}/skills/${resolved.canonical}`);
  }
  return resolved.skill;
}
