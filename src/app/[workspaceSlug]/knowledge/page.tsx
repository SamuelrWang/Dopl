/**
 * /[workspaceSlug]/knowledge — knowledge base list.
 *
 * Server component. Resolves the workspace from the slug, then calls
 * the service to fetch real DB-backed knowledge bases. Passes them as
 * props to the (client) list component for rendering. Lazy seeding
 * happens inside the service for brand-new workspaces.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import {
  buildKnowledgeContext,
  listBases,
} from "@/features/knowledge/server/service";
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

  const ctx = buildKnowledgeContext({
    userId: user.id,
    workspaceId: workspace.id,
    apiKeyId: null,
  });
  const bases = await listBases(ctx);

  return (
    <KnowledgeBasesList
      workspaceSlug={workspace.slug}
      workspaceId={workspace.id}
      bases={bases}
    />
  );
}
