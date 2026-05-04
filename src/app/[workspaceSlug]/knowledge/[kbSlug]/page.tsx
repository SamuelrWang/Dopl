/**
 * /[workspaceSlug]/knowledge/[kbSlug] — single knowledge base detail.
 *
 * Server component. Resolves the workspace, then fetches the base by
 * slug + the full tree (folders + body-stripped entries) from the
 * service. Passes the snapshot to a client component that takes over
 * for selection state and (eventually) mutations.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import {
  buildKnowledgeContext,
  getBaseTree,
  getEntry,
} from "@/features/knowledge/server/service";
import { resolvePageKbWithWorkspace } from "@/features/knowledge/server/segment";
import { KnowledgeBaseView } from "@/features/knowledge/components/knowledge-base-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string; kbSlug: string }>;
}

export default async function KnowledgeBaseDetailPage({ params }: PageProps) {
  const { workspaceSlug, kbSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(
    workspaceSlug,
    user.id,
    `knowledge/${kbSlug}`
  );

  const ctx = buildKnowledgeContext({
    userId: user.id,
    workspaceId: workspace.id,
    apiKeyId: null,
  });

  const base = await resolvePageKbWithWorkspace(ctx, workspace, kbSlug);

  const { folders, entries } = await getBaseTree(ctx, base.id);

  // SSR the first entry's body so reload paints with content instead of
  // waiting on a client-side fetch after hydration. Tree responses strip
  // bodies for size; this targeted second query brings the user's
  // initially-selected entry onto the wire alongside the shell.
  const initialEntry = entries[0]
    ? await getEntry(ctx, entries[0].id)
    : null;

  return (
    <KnowledgeBaseView
      workspaceSlug={workspaceSegment(workspace)}
      workspaceId={workspace.id}
      base={base}
      folders={folders}
      entries={entries}
      initialEntry={initialEntry}
      isOwner={base.createdBy === user.id}
    />
  );
}
