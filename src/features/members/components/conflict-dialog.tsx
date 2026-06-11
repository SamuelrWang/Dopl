"use client";

import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { TeamConflictDetails } from "../teams-client";

export interface ConflictState {
  details: TeamConflictDetails;
  /** Re-runs the original mutation with autoGrant: true. */
  retry: () => Promise<void>;
}

/**
 * Surfaces a 409 TEAM_KB_ACCESS_CONFLICT as a confirm dialog. When the
 * conflict is auto-grant-resolvable, confirming retries the original
 * change with `autoGrant: true` (creating the missing read grants).
 * Unresolvable conflicts (workspace-wide audience vs teams-scoped KB)
 * render as an informational dialog with no destructive action.
 */
export function ConflictDialog({
  conflict,
  onOpenChange,
}: {
  conflict: ConflictState | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!conflict) return null;
  const { details, retry } = conflict;
  const resolvable = details.autoGrantResolvable;

  const kbNames = [
    ...new Set(details.conflicts.map((c) => c.knowledgeBaseName)),
  ].join(", ");
  const teamNames = [
    ...new Set(
      details.conflicts.flatMap((c) => c.teams.map((t) => t.teamName))
    ),
  ];

  const description = resolvable
    ? `${teamNames.join(", ")} ${teamNames.length === 1 ? "has" : "have"} access to “${details.workflowName}” but can't read ${kbNames}. Grant read access so this change can apply?`
    : `“${details.workflowName}” is available to the whole workspace, but ${kbNames} is restricted to specific teams. Widen the knowledge base's access (or scope the workflow to teams) first.`;

  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={resolvable ? "Grant read access?" : "Access conflict"}
      description={description}
      confirmLabel={resolvable ? "Grant read access" : "Got it"}
      onConfirm={async () => {
        if (resolvable) await retry();
      }}
    />
  );
}
