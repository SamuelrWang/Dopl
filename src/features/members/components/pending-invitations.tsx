"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import type { TeamView } from "@/features/teams/types";
import type { WorkspaceInvitationView } from "../types";
import { formatRelativeTime } from "../format-last-active";
import { TeamChip } from "./team-bits";

interface Props {
  workspaceSlug: string;
  invitations: WorkspaceInvitationView[];
  teams: TeamView[];
  onRevoked?: () => void;
}

/**
 * Pending-invitations banner above the members list (admin only). Each
 * row shows the invitee's email, invited role, pre-assigned team chips,
 * send time, and a revoke button. Empty state is owned by the parent.
 */
export function PendingInvitations({
  workspaceSlug,
  invitations,
  teams,
  onRevoked,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const teamById = new Map(teams.map((t) => [t.id, t]));

  async function revoke(invitation: WorkspaceInvitationView) {
    setBusyId(invitation.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/invitations/${encodeURIComponent(
          invitation.id
        )}`,
        { method: "DELETE" }
      );
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to revoke");
      }
      onRevoked?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  if (invitations.length === 0) return null;

  return (
    <section className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5">
      <h3 className="flex items-center gap-1.5 text-label font-mono uppercase tracking-wider text-text-secondary mb-1.5">
        <Mail size={11} />
        {invitations.length} pending invitation{invitations.length > 1 ? "s" : ""}
      </h3>
      {error && <p className="text-small text-danger mb-2">{error}</p>}
      <ul className="divide-y divide-border-subtle">
        {invitations.map((inv) => (
          <li key={inv.id} className="py-2 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <p className="text-body text-text-primary truncate">{inv.email}</p>
              <p className="text-label font-mono uppercase tracking-wider text-text-muted">
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
              onClick={() => revoke(inv)}
              disabled={busyId === inv.id}
              className="shrink-0 text-label uppercase tracking-wider text-text-muted hover:text-danger transition-colors disabled:opacity-40 cursor-pointer"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

