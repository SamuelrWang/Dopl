/**
 * /[workspaceSlug]/members — workspace members + teams.
 *
 * Static UI pass — all data is hardcoded in features/members/data.ts
 * for now. Wires to real workspace_members + a new workspace_teams
 * table when the role-based access feature lands.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import { MembersView } from "@/features/members/components/members-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function MembersPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();
  return <MembersView />;
}
