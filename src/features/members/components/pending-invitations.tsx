"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import type { TeamView } from "@/features/teams/types";
import type { WorkspaceInvitationView } from "../types";
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
    <section className="rounded-lg border border-amber-400/30 bg-amber-400/[0.08] px-3 py-2.5">
      <h3 className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-amber-700/90 mb-1.5">
        <Mail size={11} />
        {invitations.length} pending invitation{invitations.length > 1 ? "s" : ""}
      </h3>
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <ul className="divide-y divide-amber-400/10">
        {invitations.map((inv) => (
          <li key={inv.id} className="py-2 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <p className="text-sm text-text-primary truncate">{inv.email}</p>
              <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/50">
                {inv.invitedRole} · sent {formatRelative(inv.createdAt)}
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
              className="shrink-0 text-[10px] uppercase tracking-wider text-text-secondary/50 hover:text-red-300 transition-colors disabled:opacity-40 cursor-pointer"
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
