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
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";
import {
  buildKnowledgeContext,
  getBaseTree,
  getEntry,
} from "@/features/knowledge/server/service";
import { resolvePageKbWithWorkspace } from "@/features/knowledge/server/segment";
import { KbDetailPreview } from "@/features/knowledge/components/knowledge-landing/kb-detail-preview";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string; kbSlug: string }>;
  searchParams: Promise<{ entryId?: string }>;
}

export default async function KnowledgeBaseDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { workspaceSlug, kbSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  const workspace = await resolvePageWorkspace(
    workspaceSlug,
    user.id,
    `knowledge/${kbSlug}`
  );

  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);
  const ctx = buildKnowledgeContext({
    userId: user.id,
    workspaceId: workspace.id,
    role: membership.role,
    agentTokenId: null,
  });

  const base = await resolvePageKbWithWorkspace(ctx, workspace, kbSlug);

  const { folders, entries } = await getBaseTree(ctx, base.id);

  // Deep-link target: honor `?entryId=` only when it belongs to THIS
  // base's already-visibility-filtered tree. Never trust the raw param to
  // probe an entry the caller can't see — membership in `entries` is the
  // access gate. Falls back to the first entry.
  const { entryId } = await searchParams;
  const selectedEntryId =
    (entryId && entries.some((e) => e.id === entryId) ? entryId : null) ??
    entries[0]?.id ??
    null;

  // SSR the selected entry's body so reload paints with content instead of
  // waiting on a client-side fetch after hydration. Tree responses strip
  // bodies for size; this targeted second query brings it onto the wire.
  const initialEntry = selectedEntryId
    ? await getEntry(ctx, selectedEntryId)
    : null;

  return (
    <KbDetailPreview
      workspaceSegment={workspaceSegment(workspace)}
      workspaceId={workspace.id}
      base={base}
      folders={folders}
      entries={entries}
      initialEntry={initialEntry}
      initialEntryId={selectedEntryId}
      currentUserId={user.id}
      role={membership.role}
    />
  );
}
