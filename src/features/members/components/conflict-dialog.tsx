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
 *
 * The copy names the DEPENDENT RESOURCE generically. The server's payload
 * field is still `workflowName` (the invariant it enforces is the
 * workflow -> KB one), but workflows are retired from the UI, so the dialog
 * must not put the word in front of a user who has no such page.
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

  const audienceIsAllMembers = details.conflicts.some(
    (c) => c.audienceIsAllMembers
  );
  // Server field name, generic in the copy — see the docblock.
  const resourceName = details.workflowName;
  const description = resolvable
    ? `${teamNames.join(", ")} ${teamNames.length === 1 ? "has" : "have"} access to “${resourceName}” but can't read ${kbNames}. Grant read access so this change can apply?`
    : audienceIsAllMembers
      ? `“${resourceName}” is available to the whole workspace, but this change would restrict ${kbNames}. Scope it to teams first, or keep the knowledge base shared.`
      : `${teamNames.join(", ")} can read “${resourceName}”, which depends on ${kbNames}. Remove ${teamNames.length === 1 ? "that team" : "those teams"} from it first, or keep their access to the knowledge base.`;

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
