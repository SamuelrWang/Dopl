/**
 * /[workspaceSlug]/knowledge — knowledge base list.
 *
 * Hardcoded UI for now. The sidebar dropdown navigates straight to a
 * specific KB; this page is the index when you click the parent
 * "Knowledge" label or the "New knowledge base" link.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import { KnowledgeBasesList } from "@/features/knowledge/components/knowledge-bases-list";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function KnowledgePage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();

  return <KnowledgeBasesList workspaceSlug={workspace.slug} />;
}
