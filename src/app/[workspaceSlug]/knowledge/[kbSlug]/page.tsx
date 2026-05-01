/**
 * /[workspaceSlug]/knowledge/[kbSlug] — single knowledge base detail.
 *
 * Server component. Resolves the workspace, then fetches the base by
 * slug + the full tree (folders + body-stripped entries) from the
 * service. Passes the snapshot to a client component that takes over
 * for selection state and (eventually) mutations.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import {
  buildKnowledgeContext,
  getBaseBySlug,
  getBaseTree,
} from "@/features/knowledge/server/service";
import { KnowledgeBaseNotFoundError } from "@/features/knowledge/server/errors";
import { KnowledgeBaseView } from "@/features/knowledge/components/knowledge-base-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string; kbSlug: string }>;
}

export default async function KnowledgeBaseDetailPage({ params }: PageProps) {
  const { workspaceSlug, kbSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();

  const ctx = buildKnowledgeContext({
    userId: user.id,
    workspaceId: workspace.id,
    apiKeyId: null,
  });

  let base;
  try {
    base = await getBaseBySlug(ctx, kbSlug);
  } catch (err) {
    if (err instanceof KnowledgeBaseNotFoundError) notFound();
    throw err;
  }

  const { folders, entries } = await getBaseTree(ctx, base.id);

  return (
    <KnowledgeBaseView
      workspaceSlug={workspace.slug}
      workspaceId={workspace.id}
      base={base}
      folders={folders}
      entries={entries}
    />
  );
}
