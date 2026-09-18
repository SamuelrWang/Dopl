"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { clusterObjectIds, type GraphState } from "../graph-state";
import {
  fetchSnapshot,
  type OntologyClusterSharing,
  type OntologyListRow,
} from "../client/api";
import { ontologySnapshotKey } from "./use-ontology";
import type { OntologySnapshot } from "../types";

/** Re-exported, not redeclared: the row shape is the client lane's
 *  (`client/api.ts`). */
export type { OntologyListRow } from "../client/api";

/**
 * The ontology list — one container's clusters as rows, for a surface that lists
 * them rather than editing one (`/home` → Ontology, spec §5).
 *
 * It shares `ontologySnapshotKey`'s cache entry with the board on purpose, so
 * opening an ontology costs no second request and a board edit moves the count
 * behind it. A key differing by one element is a silent second fetch
 * (INVARIANTS §8) — hence the key is imported, not restated.
 *
 * No realtime of its own: `client/realtime.ts › useOntologyRealtime` is the
 * board's, subscribes per workspace (R7) and refreshes this entry. A list that
 * subscribed too would double every signal.
 */
export function useOntologies(workspaceId: string | null): {
  rows: readonly OntologyListRow[];
  /** `data !== undefined`, so a FAILED read is unresolved FOREVER — read it
   *  beside `error`, never as "still pending" (F-339). */
  resolved: boolean;
  error: unknown;
  refetch: () => void;
} {
  const query = useQuery({
    queryKey: ontologySnapshotKey(workspaceId ?? ""),
    queryFn: () => fetchSnapshot(workspaceId as string),
    enabled: workspaceId !== null,
    refetchOnWindowFocus: false,
  });
  const rows = useMemo(
    () => (query.data ? ontologyListRows(query.data) : EMPTY_ROWS),
    [query.data]
  );
  return {
    rows,
    resolved: query.data !== undefined,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

/**
 * One snapshot → the rows a list renders.
 *
 * The object count is a graph walk, not a column (R5 — an object can sit in several
 * clusters): `graph-state.ts › clusterObjectIds` is that walk. A `columnIds.length`
 * here would count columns and call them objects.
 *
 * Both sharing fields take a stale-cache fallback (INVARIANTS §8), and the two
 * answers differ on purpose: `agentsMayEdit` falls back to the column default
 * (`true`, spec §3.1), a fact; `sharedChannelCount` falls back to `null` so the
 * card says nothing rather than claiming a share count it never carried.
 */
export function ontologyListRows(snapshot: OntologySnapshot): OntologyListRow[] {
  const state: GraphState = {
    clusters: snapshot.clusters,
    objects: snapshot.objects,
  };
  return snapshot.clusters.map((cluster) => {
    const sharing = cluster as typeof cluster & Partial<OntologyClusterSharing>;
    return {
      id: cluster.id,
      slug: cluster.slug,
      name: cluster.name,
      purpose: cluster.purpose,
      objectCount: clusterObjectIds(state, cluster.id).length,
      agentsMayEdit: sharing.agentsMayEdit ?? true,
      sharedChannelCount: sharing.sharedChannelCount ?? null,
    };
  });
}

/** Frozen, so a pending read does not mint a new array per render and re-run
 *  every downstream memo. */
const EMPTY_ROWS = Object.freeze([]) as readonly OntologyListRow[];
