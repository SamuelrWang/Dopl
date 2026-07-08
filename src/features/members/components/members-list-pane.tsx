"use client";

import { useState } from "react";
import { BookOpen, Check, Search, UserPlus, Users, Workflow, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import type {
  AssignableRole,
  WorkspaceInvitationView,
  WorkspaceMemberView,
} from "../types";
import { ROLE_RANK } from "@/features/workspaces/types";
import { formatLastActive, formatRelativeTime, type ActivityDot } from "../format-last-active";
import type { JoinRequestView } from "../hooks/use-join-requests";
import { Avatar, RoleSelect } from "./member-bits";
import { TeamColorTile } from "./team-bits";
import type { MembersTabKey, Selection } from "./members-view";

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

const GROUP_LABEL =
  "flex items-center gap-2 border-b border-border-subtle bg-card-surface-subtle px-3.5 py-1.5 text-label font-semibold uppercase tracking-wide text-text-secondary";

const DOT_STYLE: Record<ActivityDot, string> = {
  active: "bg-success",
  idle: "bg-surface-raised-4 ring-1 ring-border-default",
  invited: "bg-warning",
  deactivated: "bg-danger/60",
};

interface Props {
  tab: MembersTabKey;
  onTabChange: (tab: MembersTabKey) => void;
  query: string;
  onQueryChange: (q: string) => void;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  canManage: boolean;
  members: WorkspaceMemberView[];
  teams: TeamView[];
  resources: AccessMatrixResource[];
  invitations: WorkspaceInvitationView[];
  joinRequests: JoinRequestView[];
  currentUserId: string;
  onInvite: () => void;
  onCreateTeam: () => void;
  onRevokeInvitation: (id: string) => void;
  onResolveJoinRequest: (
    id: string,
    action: "approve" | "decline",
    role: AssignableRole
  ) => void;
}

const SEARCH_PLACEHOLDER: Record<MembersTabKey, string> = {
  members: "Search members",
  teams: "Search teams",
  access: "Search resources",
};

/**
 * Left list pane of the members console: header with admin actions,
 * concave search well, the Members | Teams | Access segmented switcher,
 * and the per-tab list. Admin-only queues (join requests, invited)
 * render as label-strip groups above the roster.
 */
export function MembersListPane({
  tab,
  onTabChange,
  query,
  onQueryChange,
  selection,
  onSelect,
  canManage,
  members,
  teams,
  resources,
  invitations,
  joinRequests,
  currentUserId,
  onInvite,
  onCreateTeam,
  onRevokeInvitation,
  onResolveJoinRequest,
}: Props) {
  const q = query.trim().toLowerCase();

  const visibleMembers = members
    .filter(
      (m) =>
        q === "" ||
        (m.displayName ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q)
    )
    .sort(
      (a, b) =>
        ROLE_RANK[b.role] - ROLE_RANK[a.role] ||
        (a.displayName || a.email || "").localeCompare(b.displayName || b.email || "")
    );
  const visibleTeams = teams.filter(
    (t) => q === "" || t.name.toLowerCase().includes(q)
  );
  const visibleResources = resources.filter(
    (r) => q === "" || r.name.toLowerCase().includes(q)
  );

  return (
    <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
      <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
        <h1 className="text-title font-semibold tracking-tight text-text-primary">
          Members
        </h1>
        <span className="text-caption text-text-muted">{members.length}</span>
        <span className="flex-1" />
        {canManage && (
          <>
            <button
              type="button"
              className={ICON_BTN}
              aria-label="New team"
              title="New team"
              onClick={onCreateTeam}
            >
              <Users size={16} />
            </button>
            <button
              type="button"
              className={ICON_BTN}
              aria-label="Add members"
              title="Add members"
              onClick={onInvite}
            >
              <UserPlus size={16} />
            </button>
          </>
        )}
      </div>

      <div className="concave-field relative mx-3.5 mb-3 rounded-[9px]">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={SEARCH_PLACEHOLDER[tab]}
          spellCheck={false}
          className="h-9 w-full bg-transparent pl-[33px] pr-3 text-body text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>

      <SegmentedControl
        options={[
          { key: "members" as const, label: "Members", count: members.length },
          { key: "teams" as const, label: "Teams", count: teams.length },
          { key: "access" as const, label: "Access", count: resources.length },
        ]}
        value={tab}
        onChange={onTabChange}
        className="mx-3.5 mb-3"
      />

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-default pb-4">
        {tab === "members" && (
          <>
            {canManage && joinRequests.length > 0 && (
              <JoinRequestsGroup
                requests={joinRequests}
                onResolve={onResolveJoinRequest}
              />
            )}
            {canManage && invitations.length > 0 && (
              <InvitedGroup invitations={invitations} onRevoke={onRevokeInvitation} />
            )}
            {visibleMembers.length === 0 ? (
              <EmptyCopy text={q ? "No members match." : "No members yet."} />
            ) : (
              visibleMembers.map((m) => (
                <MemberListRow
                  key={m.userId}
                  member={m}
                  isSelf={m.userId === currentUserId}
                  selected={selection?.kind === "member" && selection.id === m.userId}
                  onSelect={() => onSelect({ kind: "member", id: m.userId })}
                />
              ))
            )}
          </>
        )}

        {tab === "teams" &&
          (visibleTeams.length === 0 ? (
            <EmptyCopy
              text={
                q
                  ? "No teams match."
                  : canManage
                    ? "No teams yet — create one to scope access."
                    : "No teams yet."
              }
            />
          ) : (
            visibleTeams.map((t) => (
              <TeamListRow
                key={t.id}
                team={t}
                selected={selection?.kind === "team" && selection.id === t.id}
                onSelect={() => onSelect({ kind: "team", id: t.id })}
              />
            ))
          ))}

        {tab === "access" &&
          (visibleResources.length === 0 ? (
            <EmptyCopy
              text={q ? "No resources match." : "No knowledge bases or workflows yet."}
            />
          ) : (
            visibleResources.map((r) => (
              <ResourceListRow
                key={`${r.resourceType}:${r.resourceId}`}
                resource={r}
                grantCount={countGrants(teams, r)}
                selected={
                  selection?.kind === "resource" &&
                  selection.id === `${r.resourceType}:${r.resourceId}`
                }
                onSelect={() =>
                  onSelect({ kind: "resource", id: `${r.resourceType}:${r.resourceId}` })
                }
              />
            ))
          ))}
      </div>
    </div>
  );
}

// ─── Rows ───────────────────────────────────────────────────────────

function RowShell({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors",
        selected ? "bg-surface-raised-3" : "hover:bg-surface-raised-1"
      )}
    >
      {selected && (
        <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-[3px] bg-text-primary" />
      )}
      {children}
    </button>
  );
}

function MemberListRow({
  member: m,
  isSelf,
  selected,
  onSelect,
}: {
  member: WorkspaceMemberView;
  isSelf: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const activity = formatLastActive(m.lastSeenAt, m.status, m.invitedAt);
  return (
    <RowShell selected={selected} onSelect={onSelect}>
      <Avatar person={m} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-body font-semibold text-text-primary">
            {m.displayName || m.email || m.userId}
          </span>
          {isSelf && (
            <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-text-muted">
              You
            </span>
          )}
          <span className="flex-1" />
          <span className="shrink-0 text-micro font-medium uppercase tracking-wide text-text-secondary">
            {m.role}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-caption text-text-secondary">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_STYLE[activity.dot])} />
          <span className="min-w-0 truncate">
            {m.email && m.displayName ? `${m.email} · ` : ""}
            {activity.label}
          </span>
        </span>
      </span>
    </RowShell>
  );
}

function TeamListRow({
  team,
  selected,
  onSelect,
}: {
  team: TeamView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <RowShell selected={selected} onSelect={onSelect}>
      <TeamColorTile color={team.color} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
            {team.name}
          </span>
          <span className="shrink-0 text-micro text-text-muted">
            {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
          </span>
        </span>
        <span className="block truncate text-caption text-text-secondary">
          {team.grants.length === 0
            ? "No scoped resources"
            : `${team.grants.length} scoped ${team.grants.length === 1 ? "resource" : "resources"}`}
          {team.description ? ` · ${team.description}` : ""}
        </span>
      </span>
    </RowShell>
  );
}

function ResourceListRow({
  resource: r,
  grantCount,
  selected,
  onSelect,
}: {
  resource: AccessMatrixResource;
  grantCount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = r.resourceType === "knowledge_base" ? BookOpen : Workflow;
  return (
    <RowShell selected={selected} onSelect={onSelect}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-inset text-text-secondary">
        <Icon size={12} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
            {r.name}
          </span>
          <span className="shrink-0 text-micro font-medium uppercase tracking-wide text-text-secondary">
            {r.accessMode === "workspace" ? "Everyone" : "Teams"}
          </span>
        </span>
        <span className="block truncate text-caption text-text-secondary">
          {r.resourceType === "knowledge_base" ? "Knowledge base" : "Workflow"}
          {r.accessMode === "teams" &&
            ` · ${grantCount} ${grantCount === 1 ? "team grant" : "team grants"}`}
        </span>
      </span>
    </RowShell>
  );
}

// ─── Admin queues ───────────────────────────────────────────────────

function JoinRequestsGroup({
  requests,
  onResolve,
}: {
  requests: JoinRequestView[];
  onResolve: (id: string, action: "approve" | "decline", role: AssignableRole) => void;
}) {
  const [roles, setRoles] = useState<Record<string, AssignableRole>>({});
  return (
    <div className="border-b border-border-subtle">
      <div className={GROUP_LABEL}>
        Join requests
        <span className="text-caption font-normal normal-case tracking-normal text-text-muted">
          {requests.length}
        </span>
      </div>
      {requests.map((r) => (
        <div key={r.id} className="flex items-center gap-2 px-3.5 py-2">
          <Avatar
            person={{
              userId: r.userId,
              email: r.email,
              displayName: r.displayName,
              avatarUrl: r.avatarUrl,
            }}
            size="xs"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-semibold text-text-primary">
              {r.displayName || r.email || r.userId}
            </span>
            <span className="block truncate text-caption text-text-secondary">
              requested {formatRelativeTime(r.requestedAt)}
            </span>
          </span>
          <RoleSelect
            value={roles[r.id] ?? "member"}
            onChange={(role) => setRoles((prev) => ({ ...prev, [r.id]: role }))}
          />
          <button
            type="button"
            aria-label="Approve"
            title="Approve"
            onClick={() => onResolve(r.id, "approve", roles[r.id] ?? "member")}
            className={ICON_BTN}
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            aria-label="Decline"
            title="Decline"
            onClick={() => onResolve(r.id, "decline", roles[r.id] ?? "member")}
            className={cn(ICON_BTN, "hover:text-danger")}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function InvitedGroup({
  invitations,
  onRevoke,
}: {
  invitations: WorkspaceInvitationView[];
  onRevoke: (id: string) => void;
}) {
  return (
    <div className="border-b border-border-subtle">
      <div className={GROUP_LABEL}>
        Invited
        <span className="text-caption font-normal normal-case tracking-normal text-text-muted">
          {invitations.length}
        </span>
      </div>
      {invitations.map((inv) => (
        <div key={inv.id} className="flex items-center gap-2 px-3.5 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-semibold text-text-primary">
              {inv.email}
            </span>
            <span className="block truncate text-caption text-text-secondary">
              {inv.invitedRole} · sent {formatRelativeTime(inv.createdAt)}
            </span>
          </span>
          <button
            type="button"
            aria-label={`Revoke invitation for ${inv.email}`}
            title="Revoke invitation"
            onClick={() => onRevoke(inv.id)}
            className={cn(ICON_BTN, "hover:text-danger")}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function EmptyCopy({ text }: { text: string }) {
  return (
    <p className="px-4 py-2.5 text-caption leading-relaxed text-text-muted">{text}</p>
  );
}

function countGrants(teams: TeamView[], r: AccessMatrixResource): number {
  return teams.filter((t) =>
    t.grants.some(
      (g) => g.resourceType === r.resourceType && g.resourceId === r.resourceId
    )
  ).length;
}
