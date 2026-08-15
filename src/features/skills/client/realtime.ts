"use client";

import { useWorkspaceTablesRealtime } from "@/shared/realtime/use-workspace-tables-realtime";

// Body lives on the `skills` row, so a body edit is a `skills` UPDATE.
// skill_versions streams new history entries for the version rail.
const SKILL_TABLES = ["skills", "skill_versions"] as const;

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
