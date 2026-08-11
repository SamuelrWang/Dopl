import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { SkillContext, SkillUsage } from "../types";
import { getSkillBySlug } from "./service-reads";

/**
 * Skill insights — agent read activity (`getSkillUsage`).
 *
 * There was a second reader here, `getSkillUsedBy`, answering "what is this
 * skill attached to". Its only answer came from `workflow_skills`, so it went
 * with workflows on 2026-08-11; nothing rendered it.
 */

/**
 * Agent read activity from mcp_events (workspace-scoped via the
 * workspace_id column added in the phase-3 migration; rows logged
 * before that migration have NULL workspace_id and are excluded).
 * Matches both the skill read and its file reads.
 */
export async function getSkillUsage(
  ctx: SkillContext,
  slug: string
): Promise<SkillUsage> {
  const skill = await getSkillBySlug(ctx, slug);
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const exact = `GET /api/skills/${skill.slug}`;
  const prefix = `GET /api/skills/${skill.slug}/%`;
  const scoped = () =>
    db
      .from("mcp_events")
      .select("created_at", { count: "exact" })
      .eq("workspace_id", ctx.workspaceId)
      .or(`endpoint.eq.${exact},endpoint.like.${prefix}`);
  const [countRes, lastRes] = await Promise.all([
    scoped().gte("created_at", since).limit(1),
    scoped().order("created_at", { ascending: false }).limit(1),
  ]);
  if (countRes.error) throw countRes.error;
  if (lastRes.error) throw lastRes.error;
  const last = (lastRes.data as Array<{ created_at: string }> | null)?.[0];
  return {
    count30d: countRes.count ?? 0,
    lastUsedAt: last?.created_at ?? null,
  };
}
