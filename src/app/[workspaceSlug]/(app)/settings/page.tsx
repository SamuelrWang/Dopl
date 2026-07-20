/**
 * /[workspaceSlug]/settings — per-workspace settings. Shows General
 * (rename + description) for admins/owners, the MCP connect + connected
 * apps sections (any member), and the Danger zone (delete) for owners.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { WorkspaceSettingsForm } from "@/features/workspaces/components/workspace-settings-form";
import { WorkspaceDangerZone } from "@/features/workspaces/components/workspace-danger-zone";
import { RemoteConnect, ConnectedAppsSection } from "@/features/mcp-connect";
import { WorkspaceTrashSection } from "@/features/trash/components/workspace-trash-section";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function WorkspaceSettingsPage({ params }: PageProps) {
  const { workspaceSlug } = await params;

  const user = await getUser();
  if (!user) redirect("/login");

  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "settings");
  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);

  return (
    <div className="page-float flex flex-col antialiased">
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-2">
        <h1 className="shrink-0 text-title font-semibold tracking-tight text-text-primary">
          Settings
        </h1>
        <span className="min-w-0 truncate text-caption text-text-muted">
          {workspace.name} · <span className="font-mono">/{workspace.slug}</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
        <div className="max-w-2xl space-y-6">
          <WorkspaceSettingsForm workspace={workspace} role={membership.role} />
          <RemoteConnect />
          <ConnectedAppsSection />
          <WorkspaceTrashSection workspaceSlug={workspace.slug} workspaceId={workspace.id} />
          {membership.role === "owner" && <WorkspaceDangerZone workspace={workspace} />}
        </div>
      </div>
    </div>
  );
}
