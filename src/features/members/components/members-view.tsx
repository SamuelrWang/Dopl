"use client";

import { useCallback, useState } from "react";
import { Plus, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { meetsMinRole } from "@/features/workspaces/types";
import type { MemberRole } from "../types";
import { useMembers } from "../hooks/use-members";
import { useInvitations } from "../hooks/use-invitations";
import { useTeams } from "../hooks/use-teams";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import { MembersTab } from "./members-tab";
import { MemberDrawer } from "./member-drawer";
import { TeamsTab } from "./teams-tab";
import { AccessTab } from "./access-tab";
import { CreateTeamDialog } from "./create-team-dialog";
import { InviteDialog } from "./invite-dialog";
import { ConflictDialog, type ConflictState } from "./conflict-dialog";

type Tab = "members" | "teams" | "access";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "members", label: "Members" },
  { key: "teams", label: "Teams" },
  { key: "access", label: "Access" },
];

interface Props {
  workspaceSlug: string;
  currentUserId: string;
  myRole: MemberRole;
}

/**
 * Members page — the workspace's access-control console. One .page-float
 * surface: compact header bar (title + counts + admin actions), a
 * concave-track tab switcher (Members | Teams | Access), scrolling tab
 * body below.
 */
export function MembersView({ workspaceSlug, currentUserId, myRole }: Props) {
  const canManage = meetsMinRole(myRole, "admin");
  const [tab, setTab] = useState<Tab>("members");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const { members, loading, refresh: refreshMembers } = useMembers(workspaceSlug);
  const { invitations, refresh: refreshInvitations } = useInvitations(
    workspaceSlug,
    canManage
  );
  const { teams, loading: teamsLoading, refresh: refreshTeams } = useTeams(workspaceSlug);
  const { resources, refresh: refreshResources } = useWorkspaceResources(workspaceSlug);

  const memberList = members ?? [];
  const inviteList = invitations ?? [];
  const teamList = teams ?? [];
  const resourceList = resources ?? [];

  const onTeamsChanged = useCallback(() => {
    refreshTeams();
    refreshMembers();
    refreshResources();
  }, [refreshTeams, refreshMembers, refreshResources]);

  // Regular members only get a detail drawer for themselves; admins+
  // can inspect anyone. Backstop for the row-level gating in MembersTab.
  const selectMember = useCallback(
    (userId: string) => {
      if (!canManage && userId !== currentUserId) return;
      setSelectedMemberId(userId);
    },
    [canManage, currentUserId]
  );

  const selectedMember =
    memberList.find((m) => m.userId === selectedMemberId) ?? null;
  const pendingCount = inviteList.length;

  const tabCount = (key: Tab) =>
    key === "members" ? memberList.length : key === "teams" ? teamList.length : null;

  return (
    <div className="page-float flex flex-col antialiased">
      {/* Header bar — title, counts, tab switcher, admin actions. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-2">
        <h1 className="shrink-0 text-title font-semibold tracking-tight text-text-primary">
          Members
        </h1>
        <span className="min-w-0 truncate text-caption text-text-muted">
          {memberList.length} {memberList.length === 1 ? "person" : "people"} ·{" "}
          {teamList.length} {teamList.length === 1 ? "team" : "teams"}
          {pendingCount > 0 && ` · ${pendingCount} pending`}
        </span>

        <div className="concave-track ml-2 flex items-center gap-1">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded-[6px] px-2.5 text-small font-medium transition-colors",
                tab === key
                  ? "raised-tab text-text-primary"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              {label}
              {tabCount(key) !== null && (
                <span className="text-micro text-text-muted">{tabCount(key)}</span>
              )}
            </button>
          ))}
        </div>

        {canManage && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setCreateTeamOpen(true)}
              className="btn-light flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary"
            >
              <Users size={12} />
              Create team
            </button>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-surface-cta px-2.5 text-small font-medium text-text-on-cta transition-opacity hover:opacity-90"
            >
              <Plus size={12} />
              Add member
            </button>
          </div>
        )}
      </div>

      {/* Tab body — the page's single scroll surface. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-10">
        {tab === "members" && (
          <MembersTab
            workspaceSlug={workspaceSlug}
            currentUserId={currentUserId}
            myRole={myRole}
            members={memberList}
            invitations={inviteList}
            teams={teamList}
            loading={loading}
            onChanged={refreshMembers}
            onInvitationsChanged={refreshInvitations}
            onSelectMember={selectMember}
          />
        )}
        {tab === "teams" && (
          <TeamsTab
            workspaceSlug={workspaceSlug}
            teams={teamList}
            members={memberList}
            resources={resourceList}
            loading={teamsLoading}
            canManage={canManage}
            onTeamsChanged={onTeamsChanged}
            onCreateTeam={() => setCreateTeamOpen(true)}
            openConflict={setConflict}
          />
        )}
        {tab === "access" && (
          <AccessTab
            workspaceSlug={workspaceSlug}
            teams={teamList}
            resources={resourceList}
            canManage={canManage}
            onTeamsChanged={onTeamsChanged}
            openConflict={setConflict}
          />
        )}
      </div>

      <MemberDrawer
        workspaceSlug={workspaceSlug}
        member={selectedMember}
        teams={teamList}
        resources={resourceList}
        myRole={myRole}
        currentUserId={currentUserId}
        onClose={() => setSelectedMemberId(null)}
        onTeamsChanged={onTeamsChanged}
        onMemberChanged={refreshMembers}
      />

      <CreateTeamDialog
        workspaceSlug={workspaceSlug}
        open={createTeamOpen}
        onOpenChange={setCreateTeamOpen}
        members={memberList}
        resources={resourceList}
        currentUserId={currentUserId}
        onCreated={() => {
          onTeamsChanged();
          setTab("teams");
        }}
        openConflict={setConflict}
      />

      <InviteDialog
        workspaceSlug={workspaceSlug}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        teams={teamList}
        onInvited={() => {
          refreshInvitations();
          refreshMembers();
          refreshTeams();
        }}
      />

      <ConflictDialog
        conflict={conflict}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
      />
    </div>
  );
}
