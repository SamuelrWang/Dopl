/**
 * /[workspaceSlug]/skills — skills index page.
 *
 * Server component. Resolves the workspace, lists active skills (with
 * connectors for the detail pane), and hands them to `SkillsBrowser` —
 * the two-pane list + overview surface. The trash button in the list
 * pane opens `SkillsTrashModal` for restoring soft-deleted skills.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";
import {
  buildSkillContext,
  listSkills,
} from "@/features/skills/server/service";
import { SkillsBrowser } from "@/features/skills/components/skills-browser";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function SkillsIndexPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "skills");
  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);

  const ctx = buildSkillContext({
    userId: user.id,
    workspaceId: workspace.id,
    role: membership.role,
    agentTokenId: null,
  });

  const skills = await listSkills(ctx, { includeConnectors: true });

  return (
    <SkillsBrowser
      workspaceSlug={workspaceSegment(workspace)}
      workspaceId={workspace.id}
      currentUserId={user.id}
      skills={skills}
    />
  );
}
