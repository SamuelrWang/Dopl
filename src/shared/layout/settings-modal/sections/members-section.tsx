"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { meetsMinRole } from "@/features/workspaces/types";
import type { MemberRole } from "@/features/members/types";
import { useMembers } from "@/features/members/hooks/use-members";
import { useInvitations } from "@/features/members/hooks/use-invitations";
import { useTeams } from "@/features/members/hooks/use-teams";
import { MembersTab } from "@/features/members/components/members-tab";
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
 * button, and pending invitations. Team management and per-member
 * detail (teams, effective access) live on the full Members page.
 */
export function MembersSection({
  workspaceSegment,
  currentUserId,
  role,
}: Props) {
  const canManage = meetsMinRole(role, "admin");
  const [inviteOpen, setInviteOpen] = useState(false);
  const { members, loading, refresh: refreshMembers } = useMembers(workspaceSegment);
  const { invitations, refresh: refreshInvitations } = useInvitations(
    workspaceSegment,
    canManage,
  );
  const { teams, refresh: refreshTeams } = useTeams(workspaceSegment);

  const memberList = members ?? [];
  const teamList = teams ?? [];

  return (
    <SectionShell title="Members" subtitle="Manage who can access this workspace">
      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md bg-surface-cta px-2.5 text-small font-medium text-text-on-cta transition-opacity hover:opacity-90"
          >
            <Plus size={12} />
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
        onChanged={() => {
          refreshMembers();
          refreshTeams();
        }}
        onInvitationsChanged={refreshInvitations}
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
