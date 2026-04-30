/**
 * /[workspaceSlug]/skills — placeholder. Skill metadata on clusters is
 * a separate slice of work; this route exists so the sidebar nav
 * resolves cleanly.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";

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

  return (
    <div className="container mx-auto px-4 pt-24 pb-16 max-w-3xl">
      <h1 className="text-2xl font-semibold text-white">Skills</h1>
      <p className="mt-2 text-sm text-white/50">
        Skills for <span className="font-mono">{workspace.name}</span> —
        coming soon.
      </p>
    </div>
  );
}
