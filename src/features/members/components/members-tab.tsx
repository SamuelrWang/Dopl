"use client";

import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { SearchField } from "@/shared/ui/search-field";
import { ROLE_RANK, meetsMinRole } from "@/features/workspaces/types";
import { canShowMemberControls } from "@/features/workspaces/member-policy";
import type { TeamView } from "@/features/teams/types";
import type {
  AssignableRole,
  MemberRole,
  WorkspaceInvitationView,
  WorkspaceMemberView,
} from "../types";
import { removeMember, updateMemberRole } from "../teams-client";
import { SelectFilter } from "./member-bits";
import { MEMBER_ROW_GRID, MemberRow } from "./member-row";
import { PendingInvitations } from "./pending-invitations";
import { JoinRequestsBanner } from "./join-requests-banner";
import { MembersTableSkeleton } from "./members-skeleton";

type RoleFilter = MemberRole | "all";

interface Props {
  workspaceSlug: string;
  /** Scopes the Solo member-limit upgrade modal in the join-request
   *  queue; the 402 degrades to inline text when absent. */
  workspaceId?: string;
  currentUserId: string;
  myRole: MemberRole;
  members: WorkspaceMemberView[];
  invitations: WorkspaceInvitationView[];
  teams: TeamView[];
  loading: boolean;
  onChanged: () => void;
  onInvitationsChanged: () => void;
  /** Row-click detail hook — omit to render rows non-clickable (the
   *  settings modal has no detail surface; the full page does). */
  onSelectMember?: (userId: string) => void;
}

/**
 * Members tab: search + role/team filters, pending-invitations banner,
 * and the boxed member table (column headers on a rounded card, like the
 * reference mock). Row click opens the member drawer via `onSelectMember`.
 */
export function MembersTab({
  workspaceSlug,
  workspaceId,
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
        const r = ROLE_RANK[b.m.role] - ROLE_RANK[a.m.role];
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
      await updateMemberRole(workspaceSlug, target.userId, role);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(target: WorkspaceMemberView) {
    await removeMember(workspaceSlug, target.userId);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search members"
          size="sm"
          className="max-w-sm flex-1"
        />
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
        <span className="ml-auto text-caption text-text-muted">
          {visibleMembers.length} of {members.length}
        </span>
      </div>

      {error && <p className="text-small text-danger">{error}</p>}

      <JoinRequestsBanner
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        enabled={canManage}
        onResolved={onChanged}
      />

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
          <span className="text-label uppercase tracking-wider text-text-muted">
            Member
          </span>
          <span className="text-label uppercase tracking-wider text-text-muted">
            Role
          </span>
          <span className="text-label uppercase tracking-wider text-text-muted">
            Teams
          </span>
          <span className="text-label uppercase tracking-wider text-text-muted">
            Last active
          </span>
          <span />
        </div>

        {loading && members.length === 0 && <MembersTableSkeleton />}
        {!loading && visibleMembers.length === 0 && (
          <div className="px-4 py-10 text-center text-body text-text-muted">
            {members.length === 0
              ? "No members yet."
              : "No members match these filters."}
          </div>
        )}
        {visibleMembers.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {visibleMembers.map((m) => {
              const isSelf = m.userId === currentUserId;
              const canEditTarget = canShowMemberControls(myRole, m.role, isSelf);
              // Regular members only open their own detail view; no
              // handler at all means rows render non-clickable.
              const clickable =
                onSelectMember !== undefined && (canManage || isSelf);
              return (
                <li key={m.userId}>
                  <MemberRow
                    member={m}
                    isSelf={isSelf}
                    canEditTarget={canEditTarget}
                    clickable={clickable}
                    busy={busyId === m.userId}
                    onOpen={() => clickable && onSelectMember?.(m.userId)}
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
          if (!removeTarget) return;
          try {
            await remove(removeTarget);
          } catch (err) {
            // Surface the server's reason ("Admins cannot remove owners,
            // admins, or themselves", last-owner protection, …) —
            // ConfirmDialog swallows the throw and only keeps itself open.
            setError(err instanceof Error ? err.message : "Failed to remove");
          }
        }}
      />
    </div>
  );
}
