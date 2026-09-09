"use client";

import { ChangelogList } from "@/features/revisions/components/changelog-list";
import {
  useRestoreOntologyRevision,
  useRevisionHistory,
} from "@/features/revisions/client/hooks";
import type { Revision } from "@/features/revisions/types";

/**
 * THE ONTOLOGY'S **Changelog** — the day-grouped roll-up of every change to the
 * cluster and to every object in it (Samuel, 2026-09-09: "cluster-level roll-up
 * = the day-grouped list of everything that changed in that ontology").
 *
 * ⚠ **THE SAME LIST THE OBJECT PANEL MOUNTS**, with different rows. A second
 * component would be two places for the day heading, the agent mark and the
 * restore confirmation to drift — the rule
 * `revisions/components/changelog-list.tsx` states for its own two surfaces.
 *
 * ⚠ **RESTORE IS ADDRESSED TO THE ROW'S OWN OBJECT**, taken from
 * `revision.resourceId` — a cluster has no per-field restore door, and rows that
 * cannot be written back (the cluster's own, every association, every
 * create/delete bundle) render no Restore at all. `revisions/lib/restorable.ts`
 * states that rule once, for the button and for the server's refusal.
 */
export function ClusterChangelog({
  clusterId,
  workspaceId,
  canEdit,
}: {
  clusterId: string;
  workspaceId: string;
  canEdit: boolean;
}) {
  const history = useRevisionHistory(
    { kind: "ontology_cluster", id: clusterId },
    workspaceId
  );
  const restore = useRestoreOntologyRevision(workspaceId);

  return (
    <ChangelogList
      days={history.days}
      status={history.status}
      hasMore={history.hasMore}
      isLoadingMore={history.isLoadingMore}
      onLoadMore={history.loadMore}
      canRestore={canEdit}
      onRestore={async (revision: Revision) => {
        await restore.mutateAsync({
          objectId: revision.resourceId,
          revisionId: revision.id,
        });
        history.refetch();
      }}
    />
  );
}
