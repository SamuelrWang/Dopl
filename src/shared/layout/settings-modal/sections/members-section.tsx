"use client";

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { meetsMinRole } from "@/features/workspaces/types";
import type { MemberRole } from "@/features/members/types";
import { useMembers } from "@/features/members/hooks/use-members";
import { useInvitations } from "@/features/members/hooks/use-invitations";
import { useTeams } from "@/features/members/hooks/use-teams";
import { useWorkspaceResources } from "@/features/members/hooks/use-workspace-resources";
import { MembersTab } from "@/features/members/components/members-tab";
import { MemberDrawer } from "@/features/members/components/member-drawer";
import { InviteDialog } from "@/features/members/components/invite-dialog";
import { SectionShell } from "./section-shell";

interface Props {
  workspaceSegment: string;
  workspaceId: string;
  currentUserId: string;
  role: MemberRole;
}

/**
 * Members section — member list (admins can re-role/remove), invite
 * button, pending invitations, and the member detail drawer. Team
 * management lives on the full Members page; this section reuses its
 * pieces in the settings modal frame.
 */
export function MembersSection({
  workspaceSegment,
  currentUserId,
  role,
}: Props) {
  const canManage = meetsMinRole(role, "admin");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const { members, loading, refresh: refreshMembers } = useMembers(workspaceSegment);
  const { invitations, refresh: refreshInvitations } = useInvitations(
    workspaceSegment,
    canManage,
  );
  const { teams, refresh: refreshTeams } = useTeams(workspaceSegment);
  const { resources } = useWorkspaceResources(workspaceSegment);

  const memberList = members ?? [];
  const teamList = teams ?? [];
  // Regular members only get a detail drawer for themselves.
  const selectMember = useCallback(
    (userId: string) => {
      if (!canManage && userId !== currentUserId) return;
      setSelectedMemberId(userId);
    },
    [canManage, currentUserId]
  );
  const selectedMember =
    memberList.find((m) => m.userId === selectedMemberId) ?? null;

  return (
    <SectionShell title="Members" subtitle="Manage who can access this workspace">
      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-1.5 px-3 h-8 rounded-md border border-border-strong bg-surface-raised-3 hover:bg-surface-raised-4 transition-colors text-xs text-text-primary cursor-pointer"
          >
            <Plus size={13} />
            Add members
          </button>
        </div>
      )}

      <MembersTab
        workspaceSlug={workspaceSegment}
        currentUserId={currentUserId}
        myRole={role}
        members={memberList}
        invitations={invitations ?? []}
        teams={teamList}
        loading={loading}
        onChanged={refreshMembers}
        onInvitationsChanged={refreshInvitations}
        onSelectMember={selectMember}
      />

      <MemberDrawer
        workspaceSlug={workspaceSegment}
        member={selectedMember}
        teams={teamList}
        resources={resources ?? []}
        myRole={role}
        currentUserId={currentUserId}
        onClose={() => setSelectedMemberId(null)}
        onTeamsChanged={() => {
          refreshTeams();
          refreshMembers();
        }}
        onMemberChanged={refreshMembers}
      />

      <InviteDialog
        workspaceSlug={workspaceSegment}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        teams={teamList}
        onInvited={() => refreshInvitations()}
      />
    </SectionShell>
  );
}
