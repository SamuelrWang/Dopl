/**
 * /[workspaceSlug]/skills — workspace skill index.
 *
 * Server component. Resolves the workspace, fetches skills via the
 * service (which lazy-seeds for fresh workspaces), passes them to the
 * library-card list. Mirrors the knowledge index shape.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import {
  buildSkillContext,
  listSkills,
} from "@/features/skills/server/service";
import { SkillsList } from "@/features/skills/components/skills-list";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function SkillsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();

  const ctx = buildSkillContext({
    userId: user.id,
    workspaceId: workspace.id,
    apiKeyId: null,
  });
  const skills = await listSkills(ctx);

  return <SkillsList workspaceSlug={workspace.slug} skills={skills} />;
}
