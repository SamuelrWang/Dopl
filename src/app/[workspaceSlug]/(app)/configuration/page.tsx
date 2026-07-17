/**
 * /[workspaceSlug]/configuration — the team agent setup guide.
 *
 * Static UI preview for now: resolves the workspace for auth/canonical
 * routing, then renders the mock-data-driven view. Real guide reads
 * land with the configuration service.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { ConfigurationView } from "@/features/configuration/components/configuration-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function ConfigurationPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  await resolvePageWorkspace(workspaceSlug, user.id, "configuration");

  return <ConfigurationView />;
}
