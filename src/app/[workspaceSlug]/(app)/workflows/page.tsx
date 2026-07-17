/**
 * /[workspaceSlug]/workflows — workflows workspace page. Each workflow is an
 * agent-followable step graph (DAG with branch conditions) rendered on the
 * shared graph substrate with panel-driven editing.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { requireWorkspaceRole } from "@/features/workspaces/server/authz";
import { meetsMinRole } from "@/features/workspaces/types";
import { workspaceSegment } from "@/features/workspaces/url";
import { WorkflowsView } from "@/features/workflows/components/workflows-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function WorkflowsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "workflows");
  const role = await requireWorkspaceRole(workspace.id, user.id, "viewer");

  return (
    <WorkflowsView
      workspaceId={workspace.id}
      workspaceSegment={workspaceSegment(workspace)}
      canEdit={meetsMinRole(role, "member")}
    />
  );
}
