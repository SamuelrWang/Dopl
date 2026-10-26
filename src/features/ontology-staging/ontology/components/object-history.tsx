"use client";

import { ChangelogList } from "../../revisions/components/changelog-list";
import {
  useRestoreOntologyRevision,
  useRevisionHistory,
} from "../../revisions/client/hooks";
import type { Revision } from "@/features/revisions/types";
import { PanelSection } from "./panel-section";

/**
 * One object's History, the panel's last section. Nothing is fetched for a provisional id (a read
 * at an unanswered create's id is a guaranteed 404), so the caller passes `null` until it exists.
 */
export function ObjectHistory({
  objectId,
  workspaceId,
  canEdit,
}: {
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
