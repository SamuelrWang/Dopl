/**
 * /[workspaceSlug]/ontology — ontology workspace page (first cluster).
 * Cluster deep links live at ./[clusterSlug].
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { requireWorkspaceRole } from "@/features/workspaces/server/authz";
import { meetsMinRole } from "@/features/workspaces/types";
import { workspaceSegment } from "@/features/workspaces/url";
import { OntologyView } from "@/features/ontology/components/ontology-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function OntologyPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "ontology");
  const role = await requireWorkspaceRole(workspace.id, user.id, "viewer");

  return (
    <OntologyView
      workspaceId={workspace.id}
      workspaceSegment={workspaceSegment(workspace)}
      canManageBilling={meetsMinRole(role, "admin")}
      canEdit={meetsMinRole(role, "member")}
    />
  );
}
