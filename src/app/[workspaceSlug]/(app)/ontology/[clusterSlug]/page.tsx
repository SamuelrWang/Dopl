/**
 * /[workspaceSlug]/ontology/[clusterSlug] — a specific ontology cluster.
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
  params: Promise<{ workspaceSlug: string; clusterSlug: string }>;
}

export default async function OntologyClusterPage({ params }: PageProps) {
  const { workspaceSlug, clusterSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(
    workspaceSlug,
    user.id,
    `ontology/${clusterSlug}`
  );
  const role = await requireWorkspaceRole(workspace.id, user.id, "viewer");

  return (
    <OntologyView
      workspaceId={workspace.id}
      workspaceSegment={workspaceSegment(workspace)}
      initialClusterSlug={clusterSlug}
      canManageBilling={meetsMinRole(role, "admin")}
      canEdit={meetsMinRole(role, "member")}
    />
  );
}
