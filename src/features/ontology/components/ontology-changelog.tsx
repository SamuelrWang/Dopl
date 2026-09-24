"use client";

import { ChangelogList } from "@/features/revisions/components/changelog-list";
import {
  useRestoreOntologyRevision,
  useRevisionHistory,
} from "@/features/revisions/client/hooks";
import type { Revision } from "@/features/revisions/types";

/**
 * The ontology's Changelog — the day-grouped roll-up of every change to the ontology
 * and to every object in it (Samuel, 2026-09-09). The same list the object panel
 * mounts, with different rows.
 *
 * Restore is addressed to the row's own object (`revision.resourceId`): an ontology
 * has no per-field restore door, and rows that cannot be written back render no
 * Restore. `revisions/lib/restorable.ts` states that rule once, for the button and
 * for the server's refusal.
 */
export function OntologyChangelog({
  ontologyId,
  workspaceId,
  canEdit,
}: {
  ontologyId: string;
  workspaceId: string;
  canEdit: boolean;
}) {
  const history = useRevisionHistory(
    { kind: "ontology", id: ontologyId },
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
