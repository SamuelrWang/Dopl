"use client";

/**
 * STAGING STAND-IN for `src/features/ontology/hooks/use-ontologies.ts`: same
 * return shape, rows derived from the staging store instead of the snapshot query.
 * `ontologyListRows` is restated verbatim (the real one sits beside a fetch).
 * ⚠ PORTING: do not port this file.
 */

import { useMemo } from "react";
import { ontologyObjectIds, type GraphState } from "@/features/ontology/graph-state";
import type { OntologyListRow } from "@/features/ontology/client/api";
import { useStagingOntologyStore } from "../../store/staging-ontology-store";

export type { OntologyListRow } from "@/features/ontology/client/api";

const STAGED_LOAD_ERROR = new Error("Couldn't reach Dopl. Check your connection.");

export function useOntologies(workspaceId: string | null): {
  rows: readonly OntologyListRow[];
  resolved: boolean;
  error: unknown;
  refetch: () => void;
} {
  const { graph, scenario, setScenario } = useStagingOntologyStore();
  const rows = useMemo(
    () => (scenario === "empty" ? EMPTY_ROWS : ontologyListRows(graph)),
    [graph, scenario]
  );
  if (workspaceId === null || scenario === "pane-loading") {
    return { rows: EMPTY_ROWS, resolved: false, error: null, refetch: () => {} };
  }
  if (scenario === "list-error") {
    return {
      rows: EMPTY_ROWS,
      resolved: false,
      error: STAGED_LOAD_ERROR,
      refetch: () => setScenario("board"),
    };
  }
  return { rows, resolved: true, error: null, refetch: () => {} };
}

/** `use-ontologies.ts › ontologyListRows`, over a graph rather than a snapshot. */
export function ontologyListRows(state: GraphState): OntologyListRow[] {
  return state.ontologies.map((ontology) => ({
    id: ontology.id,
    slug: ontology.slug,
    name: ontology.name,
    purpose: ontology.purpose,
    objectCount: ontologyObjectIds(state, ontology.id).length,
    agentsMayEdit: ontology.agentsMayEdit ?? true,
    sharedChannelCount: ontology.sharedChannelCount ?? null,
  }));
}

const EMPTY_ROWS = Object.freeze([]) as readonly OntologyListRow[];
