"use client";

/**
 * STAGING COPY of `src/features/revisions/client/hooks.ts › useRevisionHistory`, trimmed to the
 * two knowledge scopes and pointed at `./revisions-api.ts` (in-memory). Same return shape.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Revision, RevisionDay } from "@/features/revisions/types";
import { groupByDay } from "@/features/revisions/lib/group";
import { fetchBaseRevisions, fetchEntryRevisions, type RevisionPageArgs } from "./revisions-api";

export type RevisionScope = { kind: "entry"; id: string } | { kind: "base"; id: string };

const FETCHERS: Record<
  RevisionScope["kind"],
  (id: string, args: RevisionPageArgs) => Promise<{ revisions: Revision[]; nextCursor: string | null }>
> = {
  entry: fetchEntryRevisions,
  base: fetchBaseRevisions,
};

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
  const [extraPages, setExtraPages] = useState<Revision[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const key = scope ? `revisions:${scope.kind}:${scope.id}:${workspaceId ?? "default"}` : null;
  const query = useQuery({
    queryKey: ["revisions", key],
    enabled: key !== null,
    queryFn: () => FETCHERS[scope!.kind](scope!.id, { workspaceId }),
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
    void FETCHERS[scope.kind](scope.id, { workspaceId, cursor: nextCursor })
      .then((p) => {
        setExtraPages((prev) => [...prev, ...p.revisions]);
        setCursor(p.nextCursor);
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
      setExtraPages([]);
      setCursor(null);
      void query.refetch();
    },
  };
}
