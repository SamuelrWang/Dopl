"use client";

import { useWorkspaceTablesRealtime } from "@/shared/realtime/use-workspace-tables-realtime";

// The SKILL.md body lives on the `skills` row (F-029) — one table to
// watch. Body edits bump body_updated_at, which is a `skills` UPDATE.
const SKILL_TABLES = ["skills"] as const;

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
