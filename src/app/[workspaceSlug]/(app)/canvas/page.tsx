/**
 * /[workspaceSlug]/canvas — the workspace ontology graph view: the
 * ontology rendered as columns-and-cards lanes with containment /
 * relationship / ref edges, backed by the same store as /ontology.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { requireWorkspaceRole } from "@/features/workspaces/server/authz";
import { meetsMinRole } from "@/features/workspaces/types";
import { GraphView } from "@/features/ontology/graph/graph-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function CanvasPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "canvas");
  const role = await requireWorkspaceRole(workspace.id, user.id, "viewer");

  return (
    <GraphView
      workspaceId={workspace.id}
      canManageBilling={meetsMinRole(role, "admin")}
      canEdit={meetsMinRole(role, "member")}
    />
  );
}
