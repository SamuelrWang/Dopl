/**
 * /[workspaceSlug]/canvas2 — live ontology graph view: the workspace
 * ontology rendered as columns-and-cards lanes with containment /
 * relationship / ref edges, backed by the same store as /ontology.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { GraphView } from "@/features/ontology/graph/graph-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function Canvas2Page({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(workspaceSlug, user.id, "canvas2");

  return <GraphView workspaceId={workspace.id} />;
}
