"use client";

import { useWorkspaceTablesRealtime } from "@/shared/realtime/use-workspace-tables-realtime";

// The SKILL.md body lives on the `skills` row (F-029) — body edits bump
// body_updated_at, a `skills` UPDATE. skill_versions streams new history
// entries so the version rail updates live when an agent writes a version.
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
