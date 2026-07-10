"use client";

import { useCallback, useMemo, useState } from "react";
import { UsersRound } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { toast } from "@/shared/ui/toast";
import { meetsMinRole } from "@/features/workspaces/types";
import type { AssignableRole, MemberRole } from "../types";
import { useMembers } from "../hooks/use-members";
import { useInvitations } from "../hooks/use-invitations";
import { useTeams } from "../hooks/use-teams";
import { useWorkspaceResources } from "../hooks/use-workspace-resources";
import { useJoinRequests } from "../hooks/use-join-requests";
import { MembersListPane } from "./members-list-pane";
import { MemberDetail } from "./member-detail";
import { TeamDetail } from "./team-detail";
import { ResourceDetail } from "./resource-detail";
import { CreateTeamDialog } from "./create-team-dialog";
import { InviteDialog } from "./invite-dialog";
import { ConflictDialog, type ConflictState } from "./conflict-dialog";

export type MembersTabKey = "members" | "teams" | "access";

export type Selection = {
  kind: "member" | "team" | "resource";
  /** userId / teamId / `${resourceType}:${resourceId}`. */
  id: string;
} | null;

const TAB_KIND: Record<MembersTabKey, NonNullable<Selection>["kind"]> = {
  members: "member",
  teams: "team",
  access: "resource",
};

interface Props {
  workspaceSlug: string;
  currentUserId: string;
  myRole: MemberRole;
}

/**
 * Members page — the workspace's access-control console as a two-pane
 * master-detail surface (same layout language as Chats and Knowledge):
 * roster/teams/resources list on the left behind a segmented switcher,
 * the selection's document on the right. No slide-out drawers.
 */
export function MembersView({ workspaceSlug, currentUserId, myRole }: Props) {
  const canManage = meetsMinRole(myRole, "admin");
  const [tab, setTab] = useState<MembersTabKey>("members");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const { members, loading, refresh: refreshMembers } = useMembers(workspaceSlug);
  const { invitations, refresh: refreshInvitations } = useInvitations(
    workspaceSlug,
    canManage
  );
  const { teams, refresh: refreshTeams } = useTeams(workspaceSlug);
  const { resources, refresh: refreshResources } = useWorkspaceResources(workspaceSlug);
  const joinRequests = useJoinRequests(workspaceSlug, canManage);

  const memberList = useMemo(() => members ?? [], [members]);
  const teamList = useMemo(() => teams ?? [], [teams]);
  const resourceList = useMemo(() => resources ?? [], [resources]);

  const onTeamsChanged = useCallback(() => {
    refreshTeams();
    refreshMembers();
    refreshResources();
  }, [refreshTeams, refreshMembers, refreshResources]);

  // Effective selection is DERIVED: an explicit pick that still exists
  // on the active tab wins; otherwise the tab's first row. Data arrives
  // async, entities get deleted — deriving (instead of syncing state)
  // means the detail pane always shows something real.
  const effectiveSelection = useMemo<Selection>(() => {
    const firstOfTab = (): Selection => {
      if (tab === "members" && memberList.length > 0) {
        return { kind: "member", id: memberList[0].userId };
      }
      if (tab === "teams" && teamList.length > 0) {
        return { kind: "team", id: teamList[0].id };
      }
      if (tab === "access" && resourceList.length > 0) {
        return {
          kind: "resource",
          id: `${resourceList[0].resourceType}:${resourceList[0].resourceId}`,
        };
      }
      return null;
    };
    if (!selection || selection.kind !== TAB_KIND[tab]) return firstOfTab();
    const exists =
      (selection.kind === "member" &&
        memberList.some((m) => m.userId === selection.id)) ||
      (selection.kind === "team" && teamList.some((t) => t.id === selection.id)) ||
      (selection.kind === "resource" &&
        resourceList.some(
          (r) => `${r.resourceType}:${r.resourceId}` === selection.id
        ));
    return exists ? selection : firstOfTab();
  }, [selection, tab, memberList, teamList, resourceList]);

  const selectedMember =
    effectiveSelection?.kind === "member"
      ? (memberList.find((m) => m.userId === effectiveSelection.id) ?? null)
      : null;
  const selectedTeam =
    effectiveSelection?.kind === "team"
      ? (teamList.find((t) => t.id === effectiveSelection.id) ?? null)
      : null;
  const selectedResource =
    effectiveSelection?.kind === "resource"
      ? (resourceList.find(
          (r) => `${r.resourceType}:${r.resourceId}` === effectiveSelection.id
        ) ?? null)
      : null;

  const handleTabChange = (next: MembersTabKey) => {
    setTab(next);
    setQuery("");
    setSelection(null);
  };

  const handleRevokeInvitation = async (id: string) => {
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/invitations/${encodeURIComponent(id)}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      if (!res.ok && res.status !== 204) throw new Error("Couldn't revoke invitation");
      refreshInvitations();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Couldn't revoke invitation" });
    }
  };

  const handleResolveJoinRequest = (
    id: string,
    action: "approve" | "decline",
    role: AssignableRole
  ) => {
    joinRequests
      .resolve(id, action, role)
      .then(() => {
        if (action === "approve") refreshMembers();
      })
      .catch((err: unknown) => {
        toast({
          title: err instanceof Error ? err.message : "Couldn't resolve request",
        });
      });
  };

  return (
    <div className="page-float flex antialiased">
      <MembersListPane
        tab={tab}
        onTabChange={handleTabChange}
        query={query}
        onQueryChange={setQuery}
        selection={effectiveSelection}
        onSelect={setSelection}
        canManage={canManage}
        members={memberList}
        teams={teamList}
        resources={resourceList}
        invitations={invitations ?? []}
        joinRequests={joinRequests.requests}
        currentUserId={currentUserId}
        onInvite={() => setInviteOpen(true)}
        onCreateTeam={() => setCreateTeamOpen(true)}
        onRevokeInvitation={(id) => void handleRevokeInvitation(id)}
        onResolveJoinRequest={handleResolveJoinRequest}
      />

      {selectedMember ? (
        <MemberDetail
          key={selectedMember.userId}
          workspaceSlug={workspaceSlug}
          member={selectedMember}
          teams={teamList}
          myRole={myRole}
          currentUserId={currentUserId}
          onMemberChanged={refreshMembers}
          onTeamsChanged={onTeamsChanged}
          onRemoved={() => {
            setSelection(null);
            refreshMembers();
            onTeamsChanged();
          }}
        />
      ) : selectedTeam ? (
        <TeamDetail
          key={selectedTeam.id}
          workspaceSlug={workspaceSlug}
          team={selectedTeam}
          members={memberList}
          resources={resourceList}
          canManage={canManage}
          onTeamsChanged={onTeamsChanged}
          onDeleted={() => {
            setSelection(null);
            onTeamsChanged();
          }}
          openConflict={setConflict}
        />
      ) : selectedResource ? (
        <ResourceDetail
          key={`${selectedResource.resourceType}:${selectedResource.resourceId}`}
          workspaceSlug={workspaceSlug}
          resource={selectedResource}
          teams={teamList}
          canManage={canManage}
          onTeamsChanged={onTeamsChanged}
          openConflict={setConflict}
        />
      ) : (
        <EmptyState
          icon={UsersRound}
          title={loading ? "Loading members…" : "Nothing to show yet."}
        />
      )}

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
          setSelection(null);
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
