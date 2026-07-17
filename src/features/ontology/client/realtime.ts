"use client";

import { useWorkspaceTablesRealtime } from "@/shared/realtime/use-workspace-tables-realtime";

const ONTOLOGY_TABLES = [
  "ontology_clusters",
  "ontology_objects",
  "ontology_memberships",
  "ontology_relationships",
] as const;

/** Realtime refetch signal for the ontology tables of a workspace. */
export function useOntologyRealtime(
  workspaceId: string | null | undefined,
  onChange: () => void
): void {
  useWorkspaceTablesRealtime(
    workspaceId,
    ONTOLOGY_TABLES,
    "ontology-realtime",
    onChange
  );
}
