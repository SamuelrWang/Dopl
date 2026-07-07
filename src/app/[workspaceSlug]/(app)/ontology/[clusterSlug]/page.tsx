/**
 * /[workspaceSlug]/ontology/[clusterSlug] — a specific ontology cluster.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import { AppPanel } from "@/shared/layout/app-shell";
import { OntologyView } from "@/features/ontology/components/ontology-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string; clusterSlug: string }>;
}

export default async function OntologyClusterPage({ params }: PageProps) {
  const { workspaceSlug, clusterSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(
    workspaceSlug,
    user.id,
    `ontology/${clusterSlug}`
  );

  return (
    <AppPanel scroll={false}>
      <OntologyView
        workspaceId={workspace.id}
        workspaceSegment={workspaceSegment(workspace)}
        initialClusterSlug={clusterSlug}
      />
    </AppPanel>
  );
}
