/**
 * /[workspaceSlug]/overview — workspace overview / home page.
 *
 * Workspace summary + members + Connect-your-app stepper, rendered in
 * the AppShell's white panel (new design language).
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import { AppPanel } from "@/shared/layout/app-shell";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { RemoteConnect } from "@/features/mcp-connect";
import { MembersWidget } from "@/features/members/components/members-widget";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function OverviewPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "overview");
  const segment = workspaceSegment(workspace);

  return (
    <AppPanel scroll={false}>
      <PageTopBar title="Overview" />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-6 max-w-4xl mx-auto space-y-3">
          <section className="rounded-2xl border border-border-default bg-[var(--panel-surface)] p-5">
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

          <MembersWidget workspaceSlug={segment} />

          <section>
            <h2 className="text-sm font-semibold text-text-primary mb-3">
              Connect an MCP client
            </h2>
            <RemoteConnect />
          </section>
        </div>
      </div>
    </AppPanel>
  );
}
