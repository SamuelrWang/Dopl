/**
 * /[workspaceSlug]/settings — per-workspace settings. Shows General
 * (rename + description) for admins/owners, the Members section (any
 * member can read; admins can invite/re-role/remove), and the Danger
 * zone (delete) for owners.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/shared/supabase/server";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import { WorkspaceSettingsForm } from "@/features/workspaces/components/workspace-settings-form";
import { ConnectionSetup } from "@/features/api-keys/components/connection-setup";
import { RemoteConnect } from "@/features/api-keys/components/remote-connect";
import { ConnectedAppsSection } from "@/features/api-keys/components/connected-apps-section";

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
    <div className="container mx-auto px-4 pt-24 pb-16 max-w-2xl">
      <Link
        href="/workspaces"
        className="text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors"
      >
        ← All workspaces
      </Link>
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
        <section>
          <h2 className="text-sm font-semibold text-text-primary mb-3">API key &amp; setup</h2>
          <p className="text-xs text-text-muted mb-3">
            For offline, CI, or headless use. The remote connection above is
            recommended for everyone else.
          </p>
          <ConnectionSetup workspaceSlug={workspaceSegment(workspace)} />
        </section>
      </div>
    </div>
  );
}
