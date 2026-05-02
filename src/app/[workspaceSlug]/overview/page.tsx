/**
 * /[workspaceSlug]/overview — workspace overview / home page.
 *
 * Workspace summary + members + API keys + Connect-your-app stepper.
 * Full-bleed dark surface, matching the chat page chrome.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import {
  findWorkspaceForMember,
  resolveMembershipOrThrow,
} from "@/features/workspaces/server/service";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { ConnectAppSection } from "@/features/api-keys/components/connect-app-section";
import { WorkspaceKeysSection } from "@/features/api-keys/components/workspace-keys-section";
import { WorkspaceMembersSection } from "@/features/workspaces/components/workspace-members-section";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function OverviewPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();
  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);

  return (
    <>
      <PageTopBar title="Overview" />
      <div className="fixed top-[52px] right-0 bottom-0 left-0 md:left-64 z-[3] pointer-events-auto overflow-y-auto">
        <div className="p-3 max-w-4xl mx-auto space-y-3">
          <section className="rounded-2xl border border-white/[0.1] bg-[var(--panel-surface)] p-5">
            <p className="text-[10px] uppercase tracking-wider text-text-secondary/60 mb-1">
              Workspace
            </p>
            <h1 className="text-xl font-semibold text-text-primary">
              {workspace.name}
            </h1>
            <p className="mt-1 text-xs text-text-secondary font-mono">
              /{workspace.slug}
            </p>
          </section>

          <WorkspaceMembersSection
            workspaceSlug={workspace.slug}
            myUserId={user.id}
            myRole={membership.role}
          />

          <WorkspaceKeysSection workspaceSlug={workspace.slug} />

          <ConnectAppSection workspaceSlug={workspace.slug} />
        </div>
      </div>
    </>
  );
}
