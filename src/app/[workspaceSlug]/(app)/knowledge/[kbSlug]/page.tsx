/**
 * /[workspaceSlug]/knowledge/[kbSlug] — single knowledge base, deep-linked.
 *
 * Server component. Resolves the base by slug (301 on stale/legacy segment),
 * fetches its tree + the `?entryId=` body, plus the full base list, and renders
 * the V2 two-pane UI with the base/entry pre-selected. The client then keeps
 * the URL in sync as the user navigates (no remount of the persistent shell).
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { meetsMinRole } from "@/features/workspaces/types";
import { workspaceSegment } from "@/features/workspaces/url";
import { listTeams } from "@/features/teams/server/service";
import {
  buildKnowledgeContext,
  getBaseTree,
  getEntry,
  listBaseOwnerNames,
  listBases,
} from "@/features/knowledge/server/service";
import { resolvePageKbWithWorkspace } from "@/features/knowledge/server/segment";
import { KnowledgeV2Preview } from "@/features/knowledge/components/knowledge-v2/landing-preview";
import type {
  BaseTree,
  KbTeamRef,
  Selection,
} from "@/features/knowledge/components/knowledge-v2/types";

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

  // Canonical 301 on stale/legacy slug; 404 on miss.
  const base = await resolvePageKbWithWorkspace(ctx, workspace, kbSlug);
  const { folders, entries } = await getBaseTree(ctx, base.id);

  // Deep-link target: honor `?entryId=` only when it belongs to THIS base's
  // already-visibility-filtered tree. Falls back to the first entry.
  const { entryId } = await searchParams;
  const selectedEntryId =
    (entryId && entries.some((e) => e.id === entryId) ? entryId : null) ??
    entries[0]?.id ??
    null;
  // SSR the selected entry's body so reload paints with content (the tree
  // strips bodies; this targeted query brings it onto the wire).
  const initialEntry = selectedEntryId
    ? await getEntry(ctx, selectedEntryId)
    : null;

  const bases = await listBases(ctx);
  const ownerNames = await listBaseOwnerNames(ctx, bases);
  const segment = workspaceSegment(workspace);

  // Admin view: kbId → teams granted, for the base overview's Teams row.
  let kbTeams: Record<string, KbTeamRef[]> | undefined;
  if (meetsMinRole(membership.role, "admin")) {
    const teams = await listTeams(workspace.id, user.id);
    kbTeams = {};
    for (const team of teams) {
      for (const grant of team.grants) {
        if (grant.resourceType !== "knowledge_base") continue;
        (kbTeams[grant.resourceId] ??= []).push({
          teamId: team.id,
          name: team.name,
          color: team.color,
        });
      }
    }
  }

  const initialTrees: Record<string, BaseTree> = {
    [base.id]: { status: "ready", folders, entries },
  };
  const initialSelection: Selection = initialEntry
    ? { kind: "entry", base, entry: initialEntry }
    : { kind: "base", base };

  return (
    <KnowledgeV2Preview
      workspaceSegment={segment}
      workspaceId={workspace.id}
      bases={bases}
      ownerNames={ownerNames}
      currentUserId={user.id}
      role={membership.role}
      kbTeams={kbTeams}
      initialSelection={initialSelection}
      initialTrees={initialTrees}
    />
  );
}
