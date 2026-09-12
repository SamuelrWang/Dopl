"use client";

import { ChangelogList } from "@/features/revisions/components/changelog-list";
import {
  useRestoreOntologyRevision,
  useRevisionHistory,
} from "@/features/revisions/client/hooks";
import type { Revision } from "@/features/revisions/types";
import { PanelSection } from "./panel-section";

/**
 * ONE OBJECT'S **History** — the HubSpot-shaped per-field timeline, inside the
 * object panel (Samuel, 2026-09-09).
 *
 * ⚠ **A SECTION OF THE PANEL, NOT A TAB.** The panel's chrome is one scrolling
 * column of editors (attributes, relationships, actions); a tab bar would be a
 * second navigation model inside a 420px pane, and history is read AFTER the
 * fields it is about rather than instead of them. So it sits last.
 *
 * ⚠ **IT IS THE SHARED LIST** (`revisions/components/changelog-list.tsx`), which
 * renders the field rows, the association rows, the agent mark and the restore
 * confirmation. Nothing about a row is spelled here.
 *
 * ⚠ **NOTHING IS FETCHED FOR A PROVISIONAL ID.** The panel opens on an optimistic
 * object id while the create POST is unanswered; a history read at that id is a
 * guaranteed 404, so the caller passes `objectId: null` until the row exists.
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
    // ⚠ **THE SAME `PanelSection` THE OTHER FOUR WEAR SINCE 2026-09-12** — this
    // section was already flat (it never had a frame), but its heading was muted
    // and unweighted, so the panel's LAST section announced itself differently
    // from the three above it. The heading is still an `h3` named "History",
    // which is what `pages/home/ontology-panels.test.tsx` matches.
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
              // ⚠ ADDRESSED TO THE ROW'S OWN OBJECT, off `resourceId` — the same
              // rule the knowledge roll-up follows. On this surface it is always
              // this object, and reading it off the row is what keeps the two
              // surfaces one code path.
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
