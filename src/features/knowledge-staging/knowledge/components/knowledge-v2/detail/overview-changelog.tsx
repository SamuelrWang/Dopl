"use client";

/** STAGING COPY of `src/features/knowledge/components/knowledge-v2/detail/overview-changelog.tsx` — verbatim; imports point at staging copies (data layer = in-memory). */
import { SectionPanel } from "@/shared/ui/section-panel";
import { ChangelogList } from "@/features/revisions/components/changelog-list";
import { useRevisionHistory } from "@/features/knowledge-staging/stubs/revisions-hooks";
import { restoreEntryRevision } from "@/features/knowledge-staging/stubs/revisions-api";
import { useQueryClient } from "@tanstack/react-query";
import type { Revision } from "@/features/revisions/types";

interface Props {
  baseId: string;
  workspaceId: string;
  /** Owners/editors may restore; viewers read. */
  canEdit: boolean;
}

/**
 * The base page's Changelog — the day-grouped roll-up of every revision of this
 * base and of everything in it. Replaced the "Contents" section on 2026-09-09.
 *
 * Restore is addressed to the ROW'S OWN ENTRY (`revision.resourceId`), not to
 * "the base" — a base has no body to restore. Rows with no body snapshot render
 * no Restore; `changelog-list.tsx` states that rule once.
 */
export function OverviewChangelog({ baseId, workspaceId, canEdit }: Props) {
  const history = useRevisionHistory({ kind: "base", id: baseId }, workspaceId);
  const queryClient = useQueryClient();

  async function restore(revision: Revision) {
    await restoreEntryRevision(revision.resourceId, revision.id, workspaceId);
    // invalidate, never patch: the restore appends a revision whose id, stamp
    // and actor the server assigns (`revisions/client/hooks.ts`).
    await queryClient.invalidateQueries({ queryKey: ["revisions"] });
    await queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    history.refetch();
  }

  return (
    <SectionPanel id="kb-changelog" label="Changelog">
      <ChangelogList
        days={history.days}
        status={history.status}
        hasMore={history.hasMore}
        isLoadingMore={history.isLoadingMore}
        onLoadMore={history.loadMore}
        canRestore={canEdit}
        onRestore={restore}
      />
    </SectionPanel>
  );
}
