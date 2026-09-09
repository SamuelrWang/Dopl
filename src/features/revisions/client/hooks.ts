"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Revision, RevisionDay } from "../types";
import { groupByDay } from "../lib/group";
import { fetchBaseRevisions, fetchEntryRevisions, restoreEntryRevision } from "./api";

/**
 * The changelog's reads, on TanStack Query.
 *
 * ⚠ **THE DAY GROUPING IS DONE HERE, OVER EVERY PAGE LOADED SO FAR** — not
 * per-page and not on the server. A page boundary falls wherever the keyset put
 * it, so grouping per page would render one calendar day as two headed groups.
 * ⚠ THE HELPER IS THE SAME ONE THE SERVER USES (`../lib/group.ts`), imported
 * rather than mirrored: it is pure and Next-free, so there is one statement of
 * the arithmetic and no pair to keep in sync.
 */

export type RevisionScope =
  | { kind: "entry"; id: string }
  | { kind: "base"; id: string };

export interface RevisionHistory {
  days: RevisionDay[];
  revisions: Revision[];
  status: "loading" | "success" | "error";
  /** `null` when the list is exhausted — never "unknown". */
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
  refetch: () => void;
}

/**
 * ⚠ **PAGES ARE ACCUMULATED IN LOCAL STATE, NOT IN AN INFINITE QUERY.** The
 * cursor is opaque and the list is append-only in time, so the only thing an
 * infinite query would add here is a second cache shape for the same rows. The
 * FIRST page stays a normal query, so a focus refetch re-reads the newest rows
 * (the ones that change) and leaves the loaded tail alone.
 */
export function useRevisionHistory(
  scope: RevisionScope | null,
  workspaceId?: string
): RevisionHistory {
  const [extraPages, setExtraPages] = useState<Revision[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const key = scope ? `revisions:${scope.kind}:${scope.id}:${workspaceId ?? "default"}` : null;
  const query = useQuery({
    queryKey: ["revisions", key],
    enabled: key !== null,
    queryFn: () =>
      scope!.kind === "entry"
        ? fetchEntryRevisions(scope!.id, { workspaceId })
        : fetchBaseRevisions(scope!.id, { workspaceId }),
  });

  const firstPage = query.data;
  const revisions = useMemo(
    () => [...(firstPage?.revisions ?? []), ...extraPages],
    [firstPage, extraPages]
  );
  const days = useMemo(() => groupByDay(revisions), [revisions]);

  const nextCursor = cursor ?? firstPage?.nextCursor ?? null;

  const loadMore = useCallback(() => {
    if (!scope || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    const load =
      scope.kind === "entry"
        ? fetchEntryRevisions(scope.id, { workspaceId, cursor: nextCursor })
        : fetchBaseRevisions(scope.id, { workspaceId, cursor: nextCursor });
    void load
      .then((page) => {
        setExtraPages((prev) => [...prev, ...page.revisions]);
        setCursor(page.nextCursor);
      })
      .finally(() => setLoadingMore(false));
  }, [scope, nextCursor, loadingMore, workspaceId]);

  return {
    days,
    revisions,
    status: query.data ? "success" : query.error ? "error" : "loading",
    hasMore: nextCursor !== null,
    loadMore,
    isLoadingMore: loadingMore,
    refetch: () => {
      // ⚠ THE TAIL IS DROPPED ON A REFETCH, deliberately: the accumulated pages
      // were read against a cursor from a list that has since grown, and keeping
      // them would show the same revision twice.
      setExtraPages([]);
      setCursor(null);
      void query.refetch();
    },
  };
}

/**
 * Restore one revision. ⚠ **INVALIDATES RATHER THAN PATCHING**, and that is the
 * one place in this feature it is right to: the write appends a revision the
 * client cannot construct (the server assigns its id, stamp and actor), so an
 * optimistic patch would render a row that does not exist yet.
 */
export function useRestoreRevision(entryId: string | null, workspaceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (revisionId: string) =>
      restoreEntryRevision(entryId as string, revisionId, workspaceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["revisions"] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
  });
}
