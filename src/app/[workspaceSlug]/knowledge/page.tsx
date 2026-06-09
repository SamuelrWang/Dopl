/**
 * /[workspaceSlug]/knowledge — knowledge area landing.
 *
 * The sidebar "Knowledge" link points here and is always navigable. When
 * the workspace has at least one knowledge base, redirect to the first one
 * (so you land in the KB detail view, where the tree-pane switcher lets you
 * pick any base). When the workspace has no bases yet, render the create /
 * empty state so new users can make their first KB.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import {
  buildKnowledgeContext,
  listBases,
} from "@/features/knowledge/server/service";
import { knowledgeBaseSegment } from "@/features/knowledge/url";
import { KnowledgeBasesList } from "@/features/knowledge/components/knowledge-bases-list";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function KnowledgeIndexPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");

  const workspace = await resolvePageWorkspace(
    workspaceSlug,
    user.id,
    "knowledge"
  );
  const ctx = buildKnowledgeContext({
    userId: user.id,
    workspaceId: workspace.id,
    apiKeyId: null,
  });
  const bases = await listBases(ctx);
  const segment = workspaceSegment(workspace);

  if (bases.length > 0) {
    redirect(`/${segment}/knowledge/${knowledgeBaseSegment(bases[0])}`);
  }

  return (
    <KnowledgeBasesList
      workspaceSlug={segment}
      workspaceId={workspace.id}
      bases={bases}
    />
  );
}
