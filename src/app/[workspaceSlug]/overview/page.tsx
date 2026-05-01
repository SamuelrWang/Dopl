/**
 * /[workspaceSlug]/overview — workspace overview / home page.
 *
 * Stub for now. Will host workspace-level summary (recent canvases,
 * skill activity, KB updates, member presence) when the dashboard
 * slice ships.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import { PageTopBar } from "@/shared/layout/page-top-bar";

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

  return (
    <>
      <PageTopBar title="Overview" />
      <div className="container mx-auto max-w-6xl px-6 pt-[68px] pb-8 pointer-events-auto">
        <div
          className="rounded-xl border border-white/[0.06] p-8"
          style={{ backgroundColor: "oklch(0.13 0 0)" }}
        >
          <p className="text-sm text-text-secondary">
            Workspace overview for{" "}
            <span className="text-text-primary font-medium">
              {workspace.name}
            </span>{" "}
            — recent canvases, skill activity, and KB updates land here.
          </p>
        </div>
      </div>
    </>
  );
}
