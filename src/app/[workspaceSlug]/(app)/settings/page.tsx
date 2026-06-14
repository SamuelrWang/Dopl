/**
 * /[workspaceSlug]/settings — per-workspace settings. Shows General
 * (rename + description) for admins/owners, the Members section (any
 * member can read; admins can invite/re-role/remove), and the Danger
 * zone (delete) for owners.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { WorkspaceSettingsForm } from "@/features/workspaces/components/workspace-settings-form";
import { RemoteConnect, ConnectedAppsSection } from "@/features/mcp-connect";
import { AppPanel } from "@/shared/layout/app-shell";

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
    <AppPanel>
    <div className="container mx-auto px-4 pt-10 pb-16 max-w-2xl">
      <div className="mt-3 mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">{workspace.name}</h1>
        <p className="text-xs text-text-muted mt-1 font-mono">
          /{workspace.slug}
        </p>
      </div>
      <div className="space-y-8">
        <WorkspaceSettingsForm workspace={workspace} role={membership.role} />
        <section>
          <h2 className="text-sm font-semibold text-text-primary mb-3">Connect an MCP client</h2>
          <RemoteConnect />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-text-primary mb-3">Connected apps</h2>
          <ConnectedAppsSection />
        </section>
      </div>
    </div>
    </AppPanel>
  );
}
