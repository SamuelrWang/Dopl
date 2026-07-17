"use client";

import { useWorkspaceTablesRealtime } from "@/shared/realtime/use-workspace-tables-realtime";

const WORKFLOW_TABLES = [
  "workflows",
  "workflow_steps",
  "workflow_step_edges",
  "workflow_knowledge_bases",
  "workflow_skills",
] as const;

/** Realtime refetch signal for the workflow tables of a workspace. */
export function useWorkflowsRealtime(
  workspaceId: string | null | undefined,
  onChange: () => void
): void {
  useWorkspaceTablesRealtime(
    workspaceId,
    WORKFLOW_TABLES,
    "workflows-realtime",
    onChange
  );
}
