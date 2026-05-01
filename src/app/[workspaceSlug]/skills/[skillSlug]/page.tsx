/**
 * /[workspaceSlug]/skills/[skillSlug] — single skill detail page.
 * Hardcoded data; will swap to a Supabase-backed lookup when the
 * skills schema lands.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import { findSkill } from "@/features/skills/data";
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

  const skill = findSkill(skillSlug);
  if (!skill) notFound();

  return <SkillView skill={skill} workspaceSlug={workspace.slug} />;
}
