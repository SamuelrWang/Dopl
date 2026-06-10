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
import { workspaceSegment } from "@/features/workspaces/url";
import {
  buildSkillContext,
  listWorkspaceKnowledgeBases,
  resolveSkillBody,
} from "@/features/skills/server/service";
import { resolvePageSkill } from "@/features/skills/server/segment";
import { AppPanel } from "@/shared/layout/app-shell";
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

  const ctx = buildSkillContext({
    userId: user.id,
    workspaceId: workspace.id,
    agentTokenId: null,
  });

  const skill = await resolvePageSkill(ctx, workspace, skillSlug);
  const [resolved, workspaceKbs] = await Promise.all([
    resolveSkillBody(ctx, skill.slug),
    listWorkspaceKnowledgeBases(ctx),
  ]);

  return (
    <AppPanel scroll={false}>
    <SkillView
      resolved={resolved}
      workspaceKbs={workspaceKbs}
      workspaceSlug={workspaceSegment(workspace)}
      isOwner={skill.createdBy === user.id}
    />
    </AppPanel>
  );
}
