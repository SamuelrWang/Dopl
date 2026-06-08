"use client";

import { useState } from "react";
import type { WorkspaceInvitationView } from "../types";

interface Props {
  workspaceSlug: string;
  invitations: WorkspaceInvitationView[];
  onRevoked?: () => void;
}

/**
 * Renders the pending invitations list for admins. Each row shows the
 * invitee's email, the role they were invited at, when it was sent, and
 * a revoke button. Empty state is owned by the parent (so it can pick
 * whether to render the section at all).
 */
export function PendingInvitations({ workspaceSlug, invitations, onRevoked }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <section className="px-4 py-4 border-t border-border-subtle">
      <h3 className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60 mb-3">
        Pending invitations · {invitations.length}
      </h3>
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <ul className="divide-y divide-border-subtle">
        {invitations.map((inv) => (
          <li
            key={inv.id}
            className="py-2.5 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="text-sm text-text-primary truncate">{inv.email}</p>
              <p className="mt-0.5 text-[10px] font-mono uppercase tracking-wider text-text-secondary/50">
                {inv.invitedRole} · sent {formatRelative(inv.createdAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => revoke(inv)}
              disabled={busyId === inv.id}
              className="text-[10px] uppercase tracking-wider text-text-secondary/50 hover:text-red-300 transition-colors disabled:opacity-40 cursor-pointer"
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
