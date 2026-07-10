"use client";

import { useWorkspaceTablesRealtime } from "@/shared/realtime/use-workspace-tables-realtime";

const KNOWLEDGE_TABLES = [
  "knowledge_bases",
  "knowledge_folders",
  "knowledge_entries",
] as const;

/** Realtime refetch signal for the knowledge tables of a workspace. */
export function useKnowledgeRealtime(
  workspaceId: string | null | undefined,
  onChange: () => void
): void {
  useWorkspaceTablesRealtime(
    workspaceId,
    KNOWLEDGE_TABLES,
    "knowledge-realtime",
    onChange
  );
}
