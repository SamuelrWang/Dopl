"use client";

/**
 * STAGING STAND-IN for `src/features/revisions/client/hooks.ts`
 * (`useRevisionHistory`, `useRestoreOntologyRevision`): same return shapes, rows
 * from the staging store's changelog; the day grouping is the real
 * `revisions/lib/group.ts`. ⚠ PORTING: do not port this file.
 */

import { useMemo, useState } from "react";
import { groupByDay } from "@/features/revisions/lib/group";
import type { Revision, RevisionDay } from "@/features/revisions/types";
import { useStagingOntologyStore } from "../../store/staging-ontology-store";

export type RevisionScope =
  | { kind: "ontology_object"; id: string }
  | { kind: "ontology"; id: string };

export interface RevisionHistory {
  days: RevisionDay[];
  revisions: Revision[];
  status: "loading" | "success" | "error";
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
  refetch: () => void;
}

export function useRevisionHistory(
  scope: RevisionScope | null,
  workspaceId?: string
): RevisionHistory {
  void workspaceId;
  const { revisions: all } = useStagingOntologyStore();
  const kind = scope?.kind;
  const id = scope?.id;
  const revisions = useMemo(() => {
    if (!kind || !id) return [];
    return all
      .filter((r) =>
        kind === "ontology" ? r.ontologyId === id : r.revision.resourceId === id
      )
      .map((r) => r.revision)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [all, kind, id]);
  const days = useMemo(() => groupByDay(revisions), [revisions]);
  return {
    days,
    revisions,
    status: "success",
    hasMore: false,
    loadMore: () => {},
    isLoadingMore: false,
    refetch: () => {},
  };
}

export function useRestoreOntologyRevision(workspaceId?: string) {
  void workspaceId;
  const store = useStagingOntologyStore();
  const [isPending, setPending] = useState(false);
  return {
    isPending,
    mutateAsync: async ({ objectId, revisionId }: { objectId: string; revisionId: string }) => {
      const row = store.revisions.find((r) => r.revision.id === revisionId);
      if (!row) return;
      setPending(true);
      try {
        await store.restore(objectId, row.revision);
      } finally {
        setPending(false);
      }
    },
  };
}
