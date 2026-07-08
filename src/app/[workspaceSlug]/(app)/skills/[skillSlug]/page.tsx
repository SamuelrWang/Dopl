/**
 * /[workspaceSlug]/skills/[skillSlug] — single skill detail.
 *
 * Server component. Resolves the workspace, fetches the skill +
 * reference availability + workspace KB list (for the picker rail),
 * hands all three to `SkillView`.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { meetsMinRole } from "@/features/workspaces/types";
import { workspaceSegment } from "@/features/workspaces/url";
import {
  buildSkillContext,
  getSkillUsage,
  getSkillUsedBy,
  listWorkspaceKnowledgeBases,
  resolveSkillBody,
} from "@/features/skills/server/service";
import { resolvePageSkill } from "@/features/skills/server/segment";
import { SkillView } from "@/features/skills/components/skill-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string; skillSlug: string }>;
}

export default async function SkillDetailPage({ params }: PageProps) {
  const { workspaceSlug, skillSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(
    workspaceSlug,
    user.id,
    `skills/${skillSlug}`
  );

  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);
  const ctx = buildSkillContext({
    userId: user.id,
    workspaceId: workspace.id,
    role: membership.role,
    agentTokenId: null,
  });

  const skill = await resolvePageSkill(ctx, workspace, skillSlug);
  const [resolved, workspaceKbs, usedBy, usage] = await Promise.all([
    resolveSkillBody(ctx, skill.slug),
    listWorkspaceKnowledgeBases(ctx),
    getSkillUsedBy(ctx, skill.slug),
    getSkillUsage(ctx, skill.slug),
  ]);

  return (
    <SkillView
      resolved={resolved}
      workspaceKbs={workspaceKbs}
      workspaceSlug={workspaceSegment(workspace)}
      usedBy={usedBy}
      usage={usage}
      isAdmin={meetsMinRole(membership.role, "admin")}
      currentUserId={user.id}
    />
  );
}
