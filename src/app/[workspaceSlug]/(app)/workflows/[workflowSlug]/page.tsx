/**
 * /[workspaceSlug]/workflows/[workflowSlug] — a specific workflow, deep-linked
 * by slug so a refresh restores the active tab (mirrors ontology/[clusterSlug]).
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
  params: Promise<{ workspaceSlug: string; workflowSlug: string }>;
}

export default async function WorkflowPage({ params }: PageProps) {
  const { workspaceSlug, workflowSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(
    workspaceSlug,
    user.id,
    `workflows/${workflowSlug}`
  );
  const role = await requireWorkspaceRole(workspace.id, user.id, "viewer");

  return (
    <WorkflowsView
      workspaceId={workspace.id}
      workspaceSegment={workspaceSegment(workspace)}
      initialWorkflowSlug={workflowSlug}
      canEdit={meetsMinRole(role, "member")}
    />
  );
}
