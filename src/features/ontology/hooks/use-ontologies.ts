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

/** ⚠ RE-EXPORTED, not redeclared: the row shape is the client lane's
 *  (`client/api.ts`), and a surface reads it through the hook it came from. */
export type { OntologyListRow } from "../client/api";

/**
 * THE ONTOLOGY LIST — one container's clusters as ROWS, for a surface that
 * lists them rather than editing one (`/home` → Ontology, spec §5).
 *
 * 🔒 **IT SHARES `ontologySnapshotKey`'s CACHE ENTRY WITH THE BOARD, AND THAT IS
 * THE POINT.** `useOntology` mounts the same `GET /api/ontology` under the same
 * key, so opening an ontology from this list costs no second request and an edit
 * on the board moves the count on the card behind it. A key differing by one
 * element would be a silent second fetch (INVARIANTS §8) — the reason the key is
 * IMPORTED from the store rather than restated here.
 *
 * ⚠ NO REALTIME OF ITS OWN. `client/realtime.ts › useOntologyRealtime` is the
 * board's, subscribes per WORKSPACE (R7) and is what refreshes this entry while
 * a board is open. A list that subscribed too would double every signal.
 */
export function useOntologies(workspaceId: string | null): {
  rows: readonly OntologyListRow[];
  /** ⚠ `data !== undefined`, so a FAILED read is unresolved FOREVER — read it
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
 * ⚠ **THE OBJECT COUNT IS A GRAPH WALK, NOT A COLUMN** (R5 — an object can sit
 * in several clusters, and `ontology_memberships` is built for it). `graph-state
 * .ts › clusterObjectIds` is that walk, already written and already tested; a
 * `columnIds.length` here would count COLUMNS and call them objects.
 *
 * 🔒 **BOTH SHARING FIELDS TAKE A STALE-CACHE FALLBACK** (INVARIANTS §8): this
 * payload is served from IndexedDB on the first paint after an upgrade, so a
 * bundle that reads them must render against a body written before they
 * existed. The two fallbacks are DIFFERENT ANSWERS and that is deliberate —
 * `agentsMayEdit` falls back to the column default (`true`, spec §3.1), which is
 * a fact about a row nobody has narrowed; `sharedChannelCount` falls back to
 * `null`, so the card SAYS NOTHING rather than claiming a share count of zero
 * that this payload never carried. UNKNOWN is not EMPTY.
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
