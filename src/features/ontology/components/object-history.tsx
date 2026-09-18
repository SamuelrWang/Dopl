"use client";

import { ChangelogList } from "@/features/revisions/components/changelog-list";
import {
  useRestoreOntologyRevision,
  useRevisionHistory,
} from "@/features/revisions/client/hooks";
import type { Revision } from "@/features/revisions/types";
import { PanelSection } from "./panel-section";

/**
 * One object's History — the per-field timeline inside the object panel (Samuel,
 * 2026-09-09). A section of the panel and not a tab: history is read after the
 * fields it is about, so it sits last.
 *
 * The rows come from the shared list
 * (`revisions/components/changelog-list.tsx`); nothing about a row is spelled here.
 *
 * Nothing is fetched for a provisional id — a read at an unanswered create's id is
 * a guaranteed 404, so the caller passes `objectId: null` until the row exists.
 */
export function ObjectHistory({
  objectId,
  workspaceId,
  canEdit,
}: {
  /** `null` while the object is provisional — the read is not made. */
  objectId: string | null;
  workspaceId: string;
  /** Editors may restore; viewers get the timeline and no button. */
  canEdit: boolean;
}) {
  const history = useRevisionHistory(
    objectId ? { kind: "ontology_object", id: objectId } : null,
    workspaceId
  );
  const restore = useRestoreOntologyRevision(workspaceId);

  return (
    // The same `PanelSection` the other four wear (2026-09-12). The heading is an
    // `h3` named "History", which is what `pages/home/ontology-panels.test.tsx`
    // matches.
    <PanelSection label="History">
      {objectId === null ? null : (
        <ChangelogList
          days={history.days}
          status={history.status}
          hasMore={history.hasMore}
          isLoadingMore={history.isLoadingMore}
          onLoadMore={history.loadMore}
          canRestore={canEdit}
          onRestore={async (revision: Revision) => {
            await restore.mutateAsync({
              // Addressed to the row's own object, off `resourceId` — always this
              // object here, but reading it off the row keeps both surfaces on one
              // code path.
              objectId: revision.resourceId,
              revisionId: revision.id,
            });
            history.refetch();
          }}
        />
      )}
    </PanelSection>
  );
}
