/**
 * /[workspaceSlug]/overview — workspace overview / home page.
 *
 * Item 5.B: workspace summary + API keys (for MCP/CLI) + connectors.
 * KB activity + member presence land here in a later pass.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import {
  findWorkspaceForMember,
  resolveMembershipOrThrow,
} from "@/features/workspaces/server/service";
import { meetsMinRole } from "@/features/workspaces/types";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { WorkspaceKeysSection } from "@/features/api-keys/components/workspace-keys-section";
import { ConnectorsSection } from "@/features/api-keys/components/connectors-section";

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
  const canCreateKeys = meetsMinRole(membership.role, "admin");

  return (
    <>
      <PageTopBar title="Overview" />
      <div className="container mx-auto max-w-4xl px-6 pt-[68px] pb-12 pointer-events-auto space-y-5">
        <div
          className="rounded-xl border border-white/[0.06] p-5"
          style={{ backgroundColor: "oklch(0.13 0 0)" }}
        >
          <p className="text-xs uppercase tracking-wider text-text-secondary/60 mb-1">
            Workspace
          </p>
          <h1 className="text-xl font-semibold text-text-primary">
            {workspace.name}
          </h1>
          <p className="mt-1 text-xs text-text-secondary font-mono">
            /{workspace.slug}
          </p>
        </div>

        <WorkspaceKeysSection
          workspaceSlug={workspace.slug}
          canCreate={canCreateKeys}
        />

        <ConnectorsSection />
      </div>
    </>
  );
}
