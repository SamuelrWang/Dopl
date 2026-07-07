/**
 * /[workspaceSlug]/ontology — ontology workspace page (first cluster).
 * Cluster deep links live at ./[clusterSlug].
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import { AppPanel } from "@/shared/layout/app-shell";
import { OntologyView } from "@/features/ontology/components/ontology-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function OntologyPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "ontology");

  return (
    <AppPanel scroll={false}>
      <OntologyView
        workspaceId={workspace.id}
        workspaceSegment={workspaceSegment(workspace)}
      />
    </AppPanel>
  );
}
