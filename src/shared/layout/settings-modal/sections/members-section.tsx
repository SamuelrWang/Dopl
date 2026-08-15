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
 * Members section — roster (admins re-role/remove), invite button, pending
 * invitations. Team management and per-member detail live on the full Members
 * page.
 */
export function MembersSection({
  workspaceSegment,
  workspaceId,
  currentUserId,
  role,
}: Props) {
  const canManage = meetsMinRole(role, "admin");
  const [inviteOpen, setInviteOpen] = useState(false);
  // ⚠ No post-write refresh for roster/teams on purpose: `MembersTab`'s writes
  // go through the mutation layer, which patches the very caches these reads
  // render from. `InviteDialog` isn't converted yet and keeps its own refresh.
  const { members, loading } = useMembers(workspaceSegment);
  const { invitations, refresh: refreshInvitations } = useInvitations(
    workspaceSegment,
    canManage,
  );
  const { teams } = useTeams(workspaceSegment);

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
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        myRole={role}
        members={memberList}
        invitations={invitations ?? []}
        teams={teamList}
        loading={loading}
      />

      <InviteDialog
        workspaceSlug={workspaceSegment}
        workspaceId={workspaceId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        teams={teamList}
        onInvited={() => refreshInvitations()}
      />
    </SectionShell>
  );
}
