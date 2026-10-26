"use client";

/**
 * STAGING STAND-IN for `src/features/ontology/hooks/use-ontology.ts` (+ its
 * create half, `use-ontology-creates.ts`). SAME RETURN SHAPE, so the copied
 * components call it unchanged; the graph comes from the in-memory staging store
 * instead of `GET /api/ontology`, and writes land there instead of PATCH/DELETE.
 *
 * The optimistic create sequences are the REAL ones
 * (`@/features/ontology/optimistic-create.ts`), run against the store's fake
 * transport, so pending rows → resolved ids behave as on desktop.
 *
 * ⚠ PORTING: do not port this file. It replaces network code only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphAction, GraphState } from "@/features/ontology/graph-state";
import {
  beginColumnDraft as beginDraft,
  commitColumnDraftOptimistic,
  createObjectOptimistic,
  createOntologyOptimistic,
  discardColumnDraft as discardDraft,
  type ColumnDraftPatch,
  type OntologyCreateSink,
} from "@/features/ontology/optimistic-create";
import type { Ontology, OntologyObject } from "@/features/ontology/types";
import { useStagingOntologyStore } from "../../store/staging-ontology-store";

/** Same key factory as the real hook (staging uses no query cache). */
export const ontologySnapshotKey = (workspaceId: string) =>
  ["ontology-snapshot", workspaceId] as const;

export type OntologyStatus = "loading" | "ready" | "error";

export interface UseOntologyOptions {
  onOverCap?: () => void;
  onCreated?: () => void;
  onIdsResolved?: (map: Readonly<Record<string, string>>) => void;
  onDeleted?: () => void;
}

const EMPTY_ONTOLOGIES: Ontology[] = [];

export function useOntology(
  _workspaceId: string,
  options: UseOntologyOptions = {}
): {
  graph: GraphState;
  status: OntologyStatus;
  dispatch: (action: GraphAction) => void;
  createOntology: () => Ontology;
  createObject: (
    target: { ontologyId: string } | { parentObjectId: string }
  ) => OntologyObject;
  beginColumnDraft: (ontologyId: string) => OntologyObject;
  discardColumnDraft: (draftId: string) => void;
  commitColumnDraft: (
    ontologyId: string,
    draft: OntologyObject,
    patch: ColumnDraftPatch
  ) => void;
  pendingIds: ReadonlySet<string>;
} {
  const store = useStagingOntologyStore();
  const { dispatch: raw, api, scenario } = store;
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());

  // "Pinned ontology gone" = the board's graph no longer carries the pin.
  const graph = useMemo<GraphState>(
    () =>
      scenario === "pinned-gone"
        ? { ...store.graph, ontologies: EMPTY_ONTOLOGIES }
        : store.graph,
    [store.graph, scenario]
  );
  const status: OntologyStatus =
    scenario === "board-loading" ? "loading" : scenario === "board-error" ? "error" : "ready";

  const dispatch = useCallback(
    (action: GraphAction) => {
      raw(action);
      if (action.type === "OBJECT_DELETE" || action.type === "ONTOLOGY_DELETE") {
        optionsRef.current.onDeleted?.();
      }
    },
    [raw]
  );

  const sink = useMemo<OntologyCreateSink>(
    () => ({
      dispatch: raw,
      markPending: (ids) =>
        setPendingIds((prev) => new Set([...prev, ...ids])),
      clearPending: (ids) =>
        setPendingIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        }),
      resolve: (map, slugs) => {
        raw(slugs ? { type: "CREATE_RESOLVE", map, slugs } : { type: "CREATE_RESOLVE", map });
        optionsRef.current.onIdsResolved?.(map);
      },
      beginWrite: () => {},
      endWrite: () => {},
      created: () => optionsRef.current.onCreated?.(),
      failed: () => optionsRef.current.onOverCap?.(),
    }),
    [raw]
  );

  const createOntology = useCallback(
    () => createOntologyOptimistic(api, sink).row,
    [api, sink]
  );
  const createObject = useCallback(
    (target: { ontologyId: string } | { parentObjectId: string }) => {
      const parent =
        "parentObjectId" in target ? store.graph.objects[target.parentObjectId] : undefined;
      return createObjectOptimistic(api, sink, target, parent).row;
    },
    [api, sink, store.graph.objects]
  );
  const beginColumnDraft = useCallback(
    (ontologyId: string) => beginDraft(sink, ontologyId),
    [sink]
  );
  const discardColumnDraft = useCallback(
    (draftId: string) => discardDraft(sink, draftId),
    [sink]
  );
  const commitColumnDraft = useCallback(
    (ontologyId: string, draft: OntologyObject, patch: ColumnDraftPatch) =>
      void commitColumnDraftOptimistic(api, sink, ontologyId, draft, patch),
    [api, sink]
  );

  return {
    graph,
    status,
    dispatch,
    createOntology,
    createObject,
    beginColumnDraft,
    discardColumnDraft,
    commitColumnDraft,
    pendingIds,
  };
}
