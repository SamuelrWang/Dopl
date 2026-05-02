/**
 * /[workspaceSlug]/skills/[skillSlug] — single skill detail.
 *
 * Server component. Resolves the workspace, fetches the skill +
 * reference availability + workspace KB list (for the picker rail),
 * hands all three to `SkillView`.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import {
  buildSkillContext,
  listWorkspaceKnowledgeBases,
  resolveSkillBody,
} from "@/features/skills/server/service";
import { SkillNotFoundError } from "@/features/skills/server/errors";
import { SkillView } from "@/features/skills/components/skill-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string; skillSlug: string }>;
}

export default async function SkillDetailPage({ params }: PageProps) {
  const { workspaceSlug, skillSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();

  const ctx = buildSkillContext({
    userId: user.id,
    workspaceId: workspace.id,
    apiKeyId: null,
  });

  const [resolved, workspaceKbs] = await Promise.all([
    resolveSkillBody(ctx, skillSlug).catch((err) => {
      if (err instanceof SkillNotFoundError) return null;
      throw err;
    }),
    listWorkspaceKnowledgeBases(ctx),
  ]);
  if (!resolved) notFound();

  return (
    <SkillView
      resolved={resolved}
      workspaceKbs={workspaceKbs}
      workspaceSlug={workspace.slug}
    />
  );
}
