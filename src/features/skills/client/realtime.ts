"use client";

import { useWorkspaceTablesRealtime } from "@/shared/realtime/use-workspace-tables-realtime";

const SKILL_TABLES = ["skills", "skill_files"] as const;

/** Realtime refetch signal for the skills tables of a workspace. */
export function useSkillsRealtime(
  workspaceId: string | null | undefined,
  onChange: () => void
): void {
  useWorkspaceTablesRealtime(
    workspaceId,
    SKILL_TABLES,
    "skills-realtime",
    onChange
  );
}
