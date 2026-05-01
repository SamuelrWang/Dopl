/**
 * /[workspaceSlug]/skills — index of all skills in the workspace,
 * exposed to connected agents over MCP. Hardcoded UI for now.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
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

  return <SkillsList workspaceSlug={workspace.slug} />;
}
