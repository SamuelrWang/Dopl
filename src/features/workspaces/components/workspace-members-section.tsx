"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { InviteMemberDialog } from "./invite-member-dialog";
import type { WorkspaceMembership, Invitation, Role } from "../types";
import { meetsMinRole } from "../types";

interface MemberRow extends WorkspaceMembership {
  email: string | null;
}

interface Props {
  workspaceSlug: string;
  myUserId: string;
  myRole: Role;
}

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const ASSIGNABLE_ROLES: Role[] = ["admin", "editor", "viewer"];

/**
 * Members section for the workspace settings page. Shows current members
 * with role chips, lets admins re-role / remove non-owners, and shows
 * pending invitations with revoke. Owner role is sticky — re-rolling
 * the last owner is blocked at the API.
 */
export function WorkspaceMembersSection({ workspaceSlug, myUserId, myRole }: Props) {
  const router = useRouter();
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const canManage = meetsMinRole(myRole, "admin");

  async function refresh() {
    setError(null);
    try {
      const [memRes, invRes] = await Promise.all([
        fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`),
        canManage
          ? fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/invitations`)
          : Promise.resolve(null),
      ]);
      if (memRes.ok) {
        const body = (await memRes.json()) as { members: MemberRow[] };
        setMembers(body.members ?? []);
      } else {
        setMembers([]);
      }
      if (invRes && invRes.ok) {
        const body = (await invRes.json()) as { invitations: Invitation[] };
        setInvitations(
          (body.invitations ?? []).filter(
            (i) => !i.revokedAt && !i.acceptedAt
          )
        );
      } else {
        setInvitations(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug]);

  async function changeRole(target: MemberRow, role: Role) {
    if (!canManage) return;
    setBusyId(target.userId);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(
          workspaceSlug
        )}/members/${encodeURIComponent(target.userId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to update role");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function removeMemberRow(target: MemberRow) {
    if (!canManage) return;
    if (target.userId === myUserId) {
      const ok = window.confirm(
        "Leave this workspace? You won't be able to rejoin without a new invitation."
      );
      if (!ok) return;
    }
    setBusyId(target.userId);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(
          workspaceSlug
        )}/members/${encodeURIComponent(target.userId)}`,
        { method: "DELETE" }
      );
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to remove");
      }
      // If you removed yourself, fall back to the workspace list.
      if (target.userId === myUserId) {
        router.push("/workspaces");
        router.refresh();
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function revokeInvite(invitation: Invitation) {
    if (!canManage) return;
    setBusyId(invitation.id);
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
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-lg bg-white/[0.03] border border-white/[0.08] p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-medium text-white">Members</h2>
          <p className="text-xs text-white/50 mt-1">
            People with access to this workspace's clusters, brain, and chats.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="h-8 px-3 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors shrink-0"
          >
            Invite
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      {!members && <p className="text-xs text-white/40">Loading…</p>}
      {members && members.length === 0 && (
        <p className="text-xs text-white/40">No members yet.</p>
      )}

      {members && members.length > 0 && (
        <ul className="divide-y divide-white/[0.06]">
          {members.map((m) => {
            const isSelf = m.userId === myUserId;
            const canEditTarget =
              canManage && m.role !== "owner" && (myRole === "owner" || m.role !== "admin");
            return (
              <li
                key={m.userId}
                className="py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">
                    {m.email || m.userId}
                    {isSelf && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-white/40">
                        You
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-white/30 mt-0.5 font-mono">
                    Joined {formatRelative(m.joinedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canEditTarget ? (
                    <select
                      value={m.role}
                      disabled={busyId === m.userId}
                      onChange={(e) => changeRole(m, e.target.value as Role)}
                      className="h-7 px-2 rounded-md bg-white/[0.06] border border-white/[0.12] text-xs text-white outline-none focus:border-white/[0.25] transition-colors"
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r} className="bg-[#0a0a0a]">
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wider text-white/50 px-2">
                      {ROLE_LABELS[m.role]}
                    </span>
                  )}
                  {canManage && m.role !== "owner" && (
                    <button
                      type="button"
                      onClick={() => removeMemberRow(m)}
                      disabled={busyId === m.userId}
                      className="text-[10px] uppercase tracking-wider text-white/40 hover:text-red-300 transition-colors disabled:opacity-40"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canManage && invitations && invitations.length > 0 && (
        <div className="mt-6 pt-5 border-t border-white/[0.06]">
          <h3 className="text-xs font-medium text-white/60 uppercase tracking-wider mb-2">
            Pending invitations
          </h3>
          <ul className="divide-y divide-white/[0.06]">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white/80 truncate">{inv.email}</p>
                  <p className="text-[10px] uppercase tracking-wider text-white/30 mt-0.5 font-mono">
                    {ROLE_LABELS[inv.invitedRole]} · sent{" "}
                    {formatRelative(inv.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => revokeInvite(inv)}
                  disabled={busyId === inv.id}
                  className="text-[10px] uppercase tracking-wider text-white/40 hover:text-red-300 transition-colors disabled:opacity-40"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <InviteMemberDialog
        workspaceSlug={workspaceSlug}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={() => void refresh()}
      />
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
