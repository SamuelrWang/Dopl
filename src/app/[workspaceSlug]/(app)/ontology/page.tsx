/**
 * /[workspaceSlug]/ontology — ontology workspace page.
 *
 * Static seeded preview: resolves the workspace for auth/canonical
 * routing, then renders the seed-driven view. Real object-graph reads
 * land with the ontology service.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
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
  await resolvePageWorkspace(workspaceSlug, user.id, "ontology");

  return (
    <AppPanel scroll={false}>
      <OntologyView />
    </AppPanel>
  );
}
