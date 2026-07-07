/**
 * /[workspaceSlug]/skills — skills index page.
 *
 * Server component. Resolves the workspace, lists active skills, and
 * hands them to `SkillsList`. The trash button in the page top bar
 * opens `SkillsTrashModal` for restoring soft-deleted skills + files.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import {
  buildSkillContext,
  listSkills,
} from "@/features/skills/server/service";
import { SkillsList } from "@/features/skills/components/skills-list";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function SkillsIndexPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "skills");

  const ctx = buildSkillContext({
    userId: user.id,
    workspaceId: workspace.id,
    agentTokenId: null,
  });

  const skills = await listSkills(ctx);

  return (
    <SkillsList
      workspaceSlug={workspaceSegment(workspace)}
      workspaceId={workspace.id}
      skills={skills}
    />
  );
}
