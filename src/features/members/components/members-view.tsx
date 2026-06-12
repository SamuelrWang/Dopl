"use client";

import { useCallback, useState } from "react";
import { Plus, Users } from "lucide-react";
import appShell from "@/shared/layout/app-shell/app-shell.module.css";
import { meetsMinRole } from "@/features/workspaces/types";
import type { MemberRole } from "../types";
import { useMembers } from "../hooks/use-members";
import { useInvitations } from "../hooks/use-invitations";
import { useTeams } from "../hooks/use-teams";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import { TabButton } from "./member-bits";
import { MembersTab } from "./members-tab";
import { MemberDrawer } from "./member-drawer";
import { TeamsTab } from "./teams-tab";
import { AccessTab } from "./access-tab";
import { CreateTeamDialog } from "./create-team-dialog";
import { InviteDialog } from "./invite-dialog";
import { ConflictDialog, type ConflictState } from "./conflict-dialog";

type Tab = "members" | "teams" | "access";

interface Props {
  workspaceSlug: string;
  currentUserId: string;
  myRole: MemberRole;
}

/**
 * Members page — knowledge-landing layout language: big title, hero
 * explainer card, then the tab strip (Members | Teams | Access) with the
 * Create team / Add member actions, then the tab content. Page scrolls
 * as one surface.
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

  return (
    <div className="px-9 pt-8 pb-16">
      {/* Title row — mirrors the Knowledge landing head. */}
      <div className="flex items-center gap-3.5 mb-6">
        <h1 className="text-[30px] font-semibold tracking-[-0.02em] text-text-primary">
          Members
        </h1>
        <span className="text-sm text-text-secondary">
          {memberList.length} {memberList.length === 1 ? "person" : "people"} ·{" "}
          {teamList.length} {teamList.length === 1 ? "team" : "teams"}
          {pendingCount > 0 && ` · ${pendingCount} pending`}
        </span>
      </div>

      {/* Hero explainer card. */}
      <section className={appShell.hero} style={{ minHeight: 240, marginBottom: 34 }}>
        <div className={appShell.heroBlobs}>
          <span style={{ width: 62, height: 62, top: 30, right: 118 }} />
          <span style={{ width: 66, height: 66, top: 26, right: 34 }} />
          <span style={{ width: 70, height: 70, top: 128, right: 178 }} />
          <span style={{ width: 72, height: 72, top: 132, right: 74 }} />
        </div>
        <div className={appShell.heroInner} style={{ padding: "38px 50px" }}>
          <h2>One workspace, organized into teams</h2>
          <p>
            Invite your people, group them into teams, and control which
            knowledge bases and workflows each team can reach.
          </p>
          {canManage && (
            <div className={appShell.heroActions}>
              <button
                type="button"
                className={appShell.tryit}
                onClick={() => setInviteOpen(true)}
              >
                Add member
              </button>
              <button
                type="button"
                className={appShell.howit}
                style={{ background: "none", border: "none", font: "inherit" }}
                onClick={() => setCreateTeamOpen(true)}
              >
                Create a team
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Tab strip + actions. */}
      <div className="flex items-center border-b border-border-default">
        <TabButton active={tab === "members"} onClick={() => setTab("members")}>
          Members
          <Count value={memberList.length} />
        </TabButton>
        <TabButton active={tab === "teams"} onClick={() => setTab("teams")}>
          Teams
          <Count value={teamList.length} />
        </TabButton>
        <TabButton active={tab === "access"} onClick={() => setTab("access")}>
          Access
        </TabButton>
        {canManage && (
          <div className="ml-auto flex items-center gap-2 pb-2">
            <button
              type="button"
              onClick={() => setCreateTeamOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border-default bg-[var(--card-surface)] hover:bg-surface-raised-2 transition-colors text-xs text-text-primary cursor-pointer"
            >
              <Users size={12} />
              Create team
            </button>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity text-xs cursor-pointer"
              style={{
                background: "var(--surface-cta)",
                color: "var(--text-on-cta)",
              }}
            >
              <Plus size={12} />
              Add member
            </button>
          </div>
        )}
      </div>

      <div className="pt-4">
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

function Count({ value }: { value: number }) {
  return (
    <span className="text-[10px] font-mono text-text-secondary/70 bg-surface-raised-2 rounded-full px-1.5 py-0.5">
      {value}
    </span>
  );
}
