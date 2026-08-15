"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import type { TeamView } from "@/features/teams/types";
import type { WorkspaceInvitationView } from "../types";
import { useInvitationWrites } from "../hooks/use-invitation-writes";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { TeamChip } from "./team-bits";

interface Props {
  workspaceSlug: string;
  invitations: WorkspaceInvitationView[];
  teams: TeamView[];
}

/** Pending-invitations banner above the members list, admin only: email,
 *  invited role, pre-assigned team chips, send time, revoke. Empty state is
 *  the parent's. */
export function PendingInvitations({
  workspaceSlug,
  invitations,
  teams,
}: Props) {
  const { revoke } = useInvitationWrites(workspaceSlug);
  const [error, setError] = useState<string | null>(null);
  // Invitation a confirm is open for. Revoke is a hard delete of the row.
  const [revokeTarget, setRevokeTarget] = useState<WorkspaceInvitationView | null>(
    null
  );
  const teamById = new Map(teams.map((t) => [t.id, t]));

  /** Row leaves in `onMutate` and the dialog closes on click, so the confirm
   *  awaits nothing. A failure restores the row from the snapshot; the banner
   *  names the server's reason, since ConfirmDialog swallows the throw. */
  async function revokeInvitation(invitation: WorkspaceInvitationView) {
    setError(null);
    setRevokeTarget(null);
    await revoke.mutateAsync({ invitationId: invitation.id }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Something went wrong");
    });
  }

  if (invitations.length === 0) return null;

  return (
    <section className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5">
      <h3 className="flex items-center gap-1.5 text-label uppercase tracking-wider text-text-secondary mb-1.5">
        <Mail size={11} />
        {invitations.length} pending invitation{invitations.length > 1 ? "s" : ""}
      </h3>
      {error && <p className="text-small text-danger mb-2">{error}</p>}
      <ul className="divide-y divide-border-subtle">
        {invitations.map((inv) => (
          <li key={inv.id} className="py-2 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <p className="text-body text-text-primary truncate">{inv.email}</p>
              <p className="text-label uppercase tracking-wider text-text-muted">
                {inv.invitedRole} · sent {formatRelativeTime(inv.createdAt)}
              </p>
              {(inv.teamIds ?? []).map((teamId) => {
                const team = teamById.get(teamId);
                return team ? (
                  <TeamChip key={teamId} name={team.name} color={team.color} />
                ) : null;
              })}
            </div>
            <button
              type="button"
              onClick={() => setRevokeTarget(inv)}
              disabled={revoke.pending}
              className="shrink-0 text-label uppercase tracking-wider text-text-muted hover:text-danger transition-colors disabled:opacity-40 cursor-pointer"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="Revoke invitation?"
        description={
          revokeTarget
            ? `This permanently revokes the invitation to ${revokeTarget.email}. Their invite link stops working, and this can't be undone.`
            : ""
        }
        confirmLabel="Revoke permanently"
        destructive
        onConfirm={async () => {
          if (revokeTarget) await revokeInvitation(revokeTarget);
        }}
      />
    </section>
  );
}

