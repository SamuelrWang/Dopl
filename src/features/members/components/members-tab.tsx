"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { meetsMinRole } from "@/features/workspaces/types";
import type { TeamView } from "@/features/teams/types";
import type {
  AssignableRole,
  MemberRole,
  WorkspaceInvitationView,
  WorkspaceMemberView,
} from "../types";
import { SelectFilter } from "./member-bits";
import { MEMBER_ROW_GRID, MemberRow } from "./member-row";
import { PendingInvitations } from "./pending-invitations";
import { MembersTableSkeleton } from "./members-skeleton";

type RoleFilter = MemberRole | "all";

const ROLE_RANK: Record<MemberRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
  viewer: 3,
};

interface Props {
  workspaceSlug: string;
  currentUserId: string;
  myRole: MemberRole;
  members: WorkspaceMemberView[];
  invitations: WorkspaceInvitationView[];
  teams: TeamView[];
  loading: boolean;
  onChanged: () => void;
  onInvitationsChanged: () => void;
  onSelectMember: (userId: string) => void;
}

/**
 * Members tab: search + role/team filters, pending-invitations banner,
 * and the boxed member table (column headers on a rounded card, like the
 * reference mock). Row click opens the member drawer via `onSelectMember`.
 */
export function MembersTab({
  workspaceSlug,
  currentUserId,
  myRole,
  members,
  invitations,
  teams,
  loading,
  onChanged,
  onInvitationsChanged,
  onSelectMember,
}: Props) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WorkspaceMemberView | null>(null);

  const canManage = meetsMinRole(myRole, "admin");

  const visibleMembers = useMemo(() => {
    const filtered = members.filter((m) => {
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (teamFilter !== "all" && !m.teams.some((t) => t.teamId === teamFilter)) {
        return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const name = (m.displayName ?? "").toLowerCase();
        const email = (m.email ?? "").toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      return true;
    });
    return filtered
      .map((m, idx) => ({ m, idx }))
      .sort((a, b) => {
        const r = ROLE_RANK[a.m.role] - ROLE_RANK[b.m.role];
        if (r !== 0) return r;
        const an = (a.m.displayName ?? a.m.email ?? "").toLowerCase();
        const bn = (b.m.displayName ?? b.m.email ?? "").toLowerCase();
        if (an < bn) return -1;
        if (an > bn) return 1;
        return a.idx - b.idx;
      })
      .map((x) => x.m);
  }, [members, search, roleFilter, teamFilter]);

  async function changeRole(target: WorkspaceMemberView, role: AssignableRole) {
    if (!canManage) return;
    setBusyId(target.userId);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(target.userId)}`,
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
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(target: WorkspaceMemberView) {
    const res = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(target.userId)}`,
      { method: "DELETE" }
    );
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || body?.error || "Failed to remove");
    }
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary/50"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members"
            className="w-full pl-7 pr-3 py-1.5 rounded-md bg-[var(--card-surface)] border border-border-default text-xs placeholder:text-text-secondary/40 outline-none focus:border-border-strong transition-colors"
          />
        </div>
        <SelectFilter
          value={roleFilter}
          onChange={(v) => setRoleFilter(v as RoleFilter)}
          options={[
            { value: "all", label: "All roles" },
            { value: "owner", label: "Owner" },
            { value: "admin", label: "Admin" },
            { value: "member", label: "Member" },
            { value: "viewer", label: "Viewer" },
          ]}
        />
        <SelectFilter
          value={teamFilter}
          onChange={setTeamFilter}
          options={[
            { value: "all", label: "All teams" },
            ...teams.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
        <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
          {visibleMembers.length} of {members.length}
        </span>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {canManage && invitations.length > 0 && (
        <PendingInvitations
          workspaceSlug={workspaceSlug}
          invitations={invitations}
          teams={teams}
          onRevoked={onInvitationsChanged}
        />
      )}

      {/* Boxed table — column headers on a rounded card, like the mock. */}
      <div className="rounded-xl border border-border-default bg-[var(--card-surface)] overflow-hidden">
        <div
          className={`${MEMBER_ROW_GRID} border-b border-border-default bg-surface-raised-1 !py-2.5`}
        >
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
            Member
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
            Role
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
            Teams
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
            Last active
          </span>
          <span />
        </div>

        {loading && members.length === 0 && <MembersTableSkeleton />}
        {!loading && visibleMembers.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-text-secondary/60">
            {members.length === 0
              ? "No members yet."
              : "No members match these filters."}
          </div>
        )}
        {visibleMembers.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {visibleMembers.map((m) => {
              const isSelf = m.userId === currentUserId;
              const canEditTarget =
                canManage &&
                !isSelf &&
                m.role !== "owner" &&
                (myRole === "owner" || m.role !== "admin");
              return (
                <li key={m.userId}>
                  <MemberRow
                    member={m}
                    isSelf={isSelf}
                    canManage={canManage}
                    canEditTarget={canEditTarget}
                    busy={busyId === m.userId}
                    onOpen={() => onSelectMember(m.userId)}
                    onChangeRole={(role) => void changeRole(m, role)}
                    onRemove={() => setRemoveTarget(m)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove member?"
        description={
          removeTarget
            ? `${removeTarget.displayName || removeTarget.email || "This member"} will lose access to the workspace and be removed from all teams.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (removeTarget) await remove(removeTarget);
        }}
      />
    </div>
  );
}
