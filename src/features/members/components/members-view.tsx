"use client";

import { useCallback, useMemo, useState } from "react";
import { UsersRound } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { DetailDocSkeleton, TwoPaneListSkeleton } from "@/shared/ui/skeleton";
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
import { ApiError } from "@/shared/api/api-client";
import { useInvitationWrites } from "../hooks/use-invitation-writes";
import { UpgradeModal } from "@/features/billing/components/upgrade-modal";

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
  /** Needed to scope the Solo member-limit upgrade modal; the join-approve
   *  402 falls back to a toast when absent. */
  workspaceId?: string;
  currentUserId: string;
  myRole: MemberRole;
}

/** Members page — access-control console as a two-pane master-detail
 *  surface: roster/teams/resources behind a segmented switcher on the left,
 *  the selection's document on the right. */
export function MembersView({
  workspaceSlug,
  workspaceId,
  currentUserId,
  myRole,
}: Props) {
  const canManage = meetsMinRole(myRole, "admin");
  const [tab, setTab] = useState<MembersTabKey>("members");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const { members, loading, refresh: refreshMembers } = useMembers(workspaceSlug);
  const { invitations, refresh: refreshInvitations } = useInvitations(
    workspaceSlug,
    canManage
  );
  const { revoke } = useInvitationWrites(workspaceSlug);
  const { teams, loading: teamsLoading, refresh: refreshTeams } = useTeams(workspaceSlug);
  const {
    resources,
    loading: resourcesLoading,
    refresh: refreshResources,
  } = useWorkspaceResources(workspaceSlug);
  const joinRequests = useJoinRequests(workspaceSlug, canManage);

  const memberList = useMemo(() => members ?? [], [members]);
  const teamList = useMemo(() => teams ?? [], [teams]);
  const resourceList = useMemo(() => resources ?? [], [resources]);

  /** ⚠ The ONE broadcast refresh, one caller: team creation is the only write
   *  here that can't patch its own caches (server mints id, memberships and
   *  grants in a single POST). Every other write patches its exact cache. */
  const onTeamCreated = useCallback(() => {
    refreshTeams();
    refreshMembers();
    refreshResources();
  }, [refreshTeams, refreshMembers, refreshResources]);

  // Selection is DERIVED, not synced: explicit pick if it still exists on the
  // active tab, else the tab's first row. Data arrives async and entities get
  // deleted, so deriving keeps the detail pane on something real.
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

  // ✕ on an invited row: leaves in `onMutate`, returns only if DELETE fails.
  const handleRevokeInvitation = (id: string) => {
    revoke.mutate({ invitationId: id });
  };

  const handleResolveJoinRequest = (
    id: string,
    action: "approve" | "decline",
    role: AssignableRole
  ) => {
    // Row drop + roster invalidation are the mutation's; only 402 is left here.
    joinRequests
      .resolve(id, action, role)
      .catch((err: unknown) => {
        // Solo is single-member, so approval is blocked server-side — offer
        // the in-place Team upgrade rather than a dead-end toast.
        if (
          err instanceof ApiError &&
          err.code === "SOLO_MEMBER_LIMIT" &&
          workspaceId
        ) {
          setUpgradeOpen(true);
          return;
        }
        toast({
          title: err instanceof Error ? err.message : "Couldn't resolve request",
        });
      });
  };

  // ⚠ Cold arrival: rendering the real panes with `members = []` claims "No
  // members yet." in a workspace that always has at least the viewer. Skeleton
  // instead — same geometry this console loads into.
  if (loading && members === null) {
    return <TwoPaneListSkeleton label="Loading members" rows={6} leading="circle" />;
  }

  // Per-tab: teams / access are separate queries, so a tab can still be
  // pending after the roster lands. Same rule — never a false empty.
  const tabLoading =
    (tab === "teams" && teamsLoading && teams === null) ||
    (tab === "access" && resourcesLoading && resources === null);

  return (
    <div className="page-float flex antialiased">
      <MembersListPane
        loading={tabLoading}
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
        onRevokeInvitation={handleRevokeInvitation}
        onResolveJoinRequest={handleResolveJoinRequest}
        queuesBusy={revoke.pending || joinRequests.resolving}
      />

      {tabLoading ? (
        <DetailDocSkeleton />
      ) : selectedMember ? (
        <MemberDetail
          key={selectedMember.userId}
          workspaceSlug={workspaceSlug}
          member={selectedMember}
          teams={teamList}
          myRole={myRole}
          currentUserId={currentUserId}
          onRemoved={() => setSelection(null)}
        />
      ) : selectedTeam ? (
        <TeamDetail
          key={selectedTeam.id}
          workspaceSlug={workspaceSlug}
          team={selectedTeam}
          members={memberList}
          resources={resourceList}
          canManage={canManage}
          onDeleted={() => setSelection(null)}
        />
      ) : selectedResource ? (
        <ResourceDetail
          key={`${selectedResource.resourceType}:${selectedResource.resourceId}`}
          workspaceSlug={workspaceSlug}
          resource={selectedResource}
          teams={teamList}
          canManage={canManage}
        />
      ) : (
        <EmptyState icon={UsersRound} title="Nothing to show yet." />
      )}

      <CreateTeamDialog
        workspaceSlug={workspaceSlug}
        open={createTeamOpen}
        onOpenChange={setCreateTeamOpen}
        members={memberList}
        resources={resourceList}
        currentUserId={currentUserId}
        onCreated={() => {
          onTeamCreated();
          setTab("teams");
          setSelection(null);
        }}
      />

      <InviteDialog
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        teams={teamList}
        onInvited={() => {
          refreshInvitations();
          refreshMembers();
          refreshTeams();
        }}
      />

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        workspaceId={workspaceId}
        canManageBilling={canManage}
        variant="add-member"
      />
    </div>
  );
}
