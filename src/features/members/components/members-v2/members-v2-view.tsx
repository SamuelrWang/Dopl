"use client";

import { useMemo, useState, type ReactNode } from "react";
import { UsersRound } from "lucide-react";
import { ApiError } from "@/shared/api/api-client";
import { toast } from "@/shared/ui/toast";
import { EmptyState } from "@/shared/ui/empty-state";
import { TwoPaneListSkeleton } from "@/shared/ui/skeleton";
import { meetsMinRole } from "@/features/workspaces/types";
import { UpgradeModal } from "@/features/billing/components/upgrade-modal";
import type { TeamView } from "@/features/teams/types";
import type { AssignableRole, MemberRole, WorkspaceMemberView } from "../../types";
import { useMembers } from "../../hooks/use-members";
import { useInvitations } from "../../hooks/use-invitations";
import { useInvitationWrites } from "../../hooks/use-invitation-writes";
import { useJoinRequests } from "../../hooks/use-join-requests";
import { useTeams } from "../../hooks/use-teams";
import { useMemberWrites } from "../../hooks/use-member-writes";
import { useTeamWrites } from "../../hooks/use-team-writes";
import { useWorkspaceResources } from "../../hooks/use-workspace-resources";
import { InviteDialog } from "../invite-dialog";
import { CreateTeamDialog } from "../create-team-dialog";
import { useMyProfile } from "./hooks";
import { ListPane, type ListTabKey } from "./list-pane";
import { EmptyDetailPane, MemberDetailPane } from "./detail-pane";
import { TeamDetailPane } from "./team-detail-pane";
import { workspaceVisibility, type Viewer } from "./visibility";

type Selection = { kind: "member"; id: string } | { kind: "team"; id: string };

interface Props {
  workspaceSlug: string;
  /** Scopes the Solo member-limit upgrade modal. */
  workspaceId?: string;
  currentUserId: string;
  myRole: MemberRole;
  /**
   * THE HOST'S OWN LOADING SHAPE for the cold roster read below.
   *
   * ⚠ A SLOT BECAUSE THIS FILE CANNOT IMPORT ONE. The desktop page's skeleton
   * lives in `apps/desktop-ui/`, which the shared tree may not reach into —
   * same idiom as `agent-templates-core.tsx › loadingSkeleton`. It exists
   * because /members has TWO gates back to back (the seam's workspace resolve,
   * then this read) and the second one painting a different ghost made one page
   * swap skeletons mid-load. Omitted, the shared two-pane ghost stands.
   */
  loadingSkeleton?: ReactNode;
}

/**
 * Members — the workspace access-control console. Two permanent panes: the
 * roster (or teams) on the left, one member's or one team's detail on the
 * right, opening on the signed-in user.
 *
 * What each surface renders is decided in `visibility.ts`; the matrix and the
 * server counterpart of every rule are in `docs/MEMBERS-AUTHORIZATION.md`.
 */
export function MembersV2View({
  workspaceSlug,
  workspaceId,
  currentUserId,
  myRole,
  loadingSkeleton,
}: Props) {
  const canManage = meetsMinRole(myRole, "admin");
  const viewer: Viewer = { userId: currentUserId, role: myRole };
  const workspace = workspaceVisibility(viewer);

  const { members, loading, error, refresh } = useMembers(workspaceSlug);
  const { invitations, refresh: refreshInvitations } = useInvitations(
    workspaceSlug,
    canManage
  );
  const { teams, refresh: refreshTeams } = useTeams(workspaceSlug);
  const { resources } = useWorkspaceResources(workspaceSlug);
  const joinRequests = useJoinRequests(workspaceSlug, canManage);
  const memberWrites = useMemberWrites(workspaceSlug);
  const teamWrites = useTeamWrites(workspaceSlug);
  const { revoke } = useInvitationWrites(workspaceSlug);

  const [listTab, setListTab] = useState<ListTabKey>("members");
  const [selection, setSelection] = useState<Selection>({
    kind: "member",
    id: currentUserId,
  });
  const [query, setQuery] = useState("");
  const [openDialog, setOpenDialog] = useState<"invite" | "create-team" | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Only the self view renders a bio, so only the self view fetches one.
  const { profile } = useMyProfile(
    selection.kind === "member" && selection.id === currentUserId
  );

  const memberList = useMemo(() => members ?? [], [members]);
  const teamList = useMemo(() => teams ?? [], [teams]);
  const busy = memberWrites.pending || teamWrites.pending || revoke.pending;

  const openMember =
    selection.kind === "member"
      ? (memberList.find((m) => m.userId === selection.id) ?? null)
      : null;
  const openTeam =
    selection.kind === "team"
      ? (teamList.find((t) => t.id === selection.id) ?? null)
      : null;

  function reportError(err: unknown, fallback: string) {
    toast({ title: err instanceof Error ? err.message : fallback });
  }

  const handleRoleChange = (userId: string, role: AssignableRole) => {
    memberWrites.setRole
      .mutateAsync({ userId, role })
      .catch((err) => reportError(err, "Couldn't change the role"));
  };

  const handleRemove = (member: WorkspaceMemberView) => {
    memberWrites.remove
      .mutateAsync({ userId: member.userId })
      .then(() => setSelection({ kind: "member", id: currentUserId }))
      .catch((err) => reportError(err, "Couldn't remove the member"));
  };

  const handleResolveJoinRequest = (
    id: string,
    action: "approve" | "decline",
    role: AssignableRole
  ) => {
    joinRequests.resolve(id, action, role).catch((err: unknown) => {
      // Solo is single-member, so approval is blocked server-side — offer the
      // in-place Team upgrade rather than a dead-end toast.
      if (err instanceof ApiError && err.code === "SOLO_MEMBER_LIMIT" && workspaceId) {
        setUpgradeOpen(true);
        return;
      }
      reportError(err, "Couldn't resolve the request");
    });
  };

  const handleJoinTeam = (userId: string, team: TeamView) => {
    teamWrites.addMembers
      .mutateAsync({ team, userIds: [userId] })
      .catch((err) => reportError(err, "Couldn't add to the team"));
  };

  const handleLeaveTeam = (userId: string, team: TeamView) => {
    teamWrites.removeMembers
      .mutateAsync({ team, userIds: [userId] })
      .catch((err) => reportError(err, "Couldn't remove from the team"));
  };

  const handleDeleteTeam = (team: TeamView) => {
    // ⚠ Roster captured at submit: the row leaves the cache the moment the
    // optimistic patch runs.
    teamWrites.remove
      .mutateAsync({ teamId: team.id, memberIds: team.memberIds })
      .then(() => setSelection({ kind: "member", id: currentUserId }))
      .catch((err) => reportError(err, "Couldn't delete the team"));
  };

  const teamById = (teamId: string) => teamList.find((t) => t.id === teamId) ?? null;

  // ⚠ A FAILED roster read must not fall through to the panes: `members` is
  // null either way, and the list would render "No members yet." over a
  // workspace that has members.
  if (error && members === null) {
    return (
      <div className="page-float flex items-center justify-center antialiased">
        <EmptyState
          icon={UsersRound}
          title="Couldn't load members."
          description="Check your connection, then try again."
        >
          <button
            type="button"
            onClick={() => void refresh()}
            className="btn-light rounded-md px-2.5 py-1 text-small font-medium text-text-primary"
          >
            Retry
          </button>
        </EmptyState>
      </div>
    );
  }

  // Cold arrival: the roster is the page, so it gets a skeleton rather than
  // panes over an empty list. ⚠ THE HOST'S SHAPE WHEN IT SUPPLIED ONE — see
  // `loadingSkeleton`; the shared ghost is the fallback, never the override.
  if (loading && members === null) {
    return (
      loadingSkeleton ?? (
        <TwoPaneListSkeleton label="Loading members" rows={6} leading="circle" />
      )
    );
  }

  return (
    <div className="page-float grid grid-cols-[minmax(380px,42fr)_minmax(0,58fr)] antialiased">
      <ListPane
        members={memberList}
        invitations={invitations ?? []}
        joinRequests={joinRequests.requests}
        teams={teamList}
        tab={listTab}
        onTabChange={setListTab}
        query={query}
        onQueryChange={setQuery}
        openMemberId={selection.kind === "member" ? selection.id : null}
        openTeamId={selection.kind === "team" ? selection.id : null}
        onOpenMember={(id) => setSelection({ kind: "member", id })}
        onOpenTeam={(id) => setSelection({ kind: "team", id })}
        canInvite={workspace.canInvite}
        canManageTeams={workspace.canManageTeams}
        showRowActions={workspace.showRowActions}
        canSeePresence={(userId) => canManage || userId === currentUserId}
        busy={busy}
        onInvite={() => setOpenDialog("invite")}
        onCreateTeam={() => setOpenDialog("create-team")}
        onRemoveMember={handleRemove}
        onRevokeInvitation={(id) => revoke.mutate({ invitationId: id })}
        onResolveJoinRequest={handleResolveJoinRequest}
      />

      {openMember ? (
        <MemberDetailPane
          key={openMember.userId}
          workspaceSlug={workspaceSlug}
          member={openMember}
          teams={teamList}
          viewer={viewer}
          bio={profile?.bio ?? null}
          busy={busy}
          onRoleChange={handleRoleChange}
          onRemove={handleRemove}
          onJoinTeam={(userId, teamId) => {
            const team = teamById(teamId);
            if (team) handleJoinTeam(userId, team);
          }}
          onLeaveTeam={(userId, teamId) => {
            const team = teamById(teamId);
            if (team) handleLeaveTeam(userId, team);
          }}
        />
      ) : openTeam ? (
        <TeamDetailPane
          team={openTeam}
          members={memberList}
          resources={resources ?? []}
          canManage={workspace.canManageTeams}
          busy={busy}
          onAddMember={(userId) => handleJoinTeam(userId, openTeam)}
          onRemoveMember={(userId) => handleLeaveTeam(userId, openTeam)}
          onDeleteTeam={() => handleDeleteTeam(openTeam)}
        />
      ) : (
        <EmptyDetailPane />
      )}

      <InviteDialog
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        open={openDialog === "invite"}
        onOpenChange={(open) => setOpenDialog(open ? "invite" : null)}
        teams={teamList}
        onInvited={() => {
          refreshInvitations();
          refreshTeams();
        }}
      />

      <CreateTeamDialog
        workspaceSlug={workspaceSlug}
        open={openDialog === "create-team"}
        onOpenChange={(open) => setOpenDialog(open ? "create-team" : null)}
        members={memberList}
        resources={resources ?? []}
        currentUserId={currentUserId}
        onCreated={() => {
          refreshTeams();
          setListTab("teams");
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
