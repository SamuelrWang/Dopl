"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { meetsMinRole } from "@/features/workspaces/types";
import type { MemberRole } from "@/features/members/types";
import { useMembers } from "@/features/members/hooks/use-members";
import { useInvitations } from "@/features/members/hooks/use-invitations";
import { MembersTable } from "@/features/members/components/members-table";
import { PendingInvitations } from "@/features/members/components/pending-invitations";
import { InviteDialog } from "@/features/members/components/invite-dialog";
import { SectionShell } from "./section-shell";

interface Props {
  workspaceSegment: string;
  workspaceId: string;
  currentUserId: string;
  role: MemberRole;
}

/**
 * Members section — flat members table (admins can re-role/remove),
 * an invite button, and the pending-invitations list for managers.
 * Composes the low-level members pieces directly (not the full-page
 * MembersView, which assumes a fixed page layout).
 */
export function MembersSection({
  workspaceSegment,
  workspaceId,
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

  return (
    <SectionShell title="Members" subtitle="Manage who can access this workspace">
      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-1.5 px-3 h-8 rounded-md border border-white/[0.12] bg-white/[0.06] hover:bg-white/[0.1] transition-colors text-xs text-white cursor-pointer"
          >
            <Plus size={13} />
            Add members
          </button>
        </div>
      )}

      <MembersTable
        workspaceSlug={workspaceSegment}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        myRole={role}
        members={members ?? []}
        loading={loading}
        onChanged={refreshMembers}
      />

      {canManage && invitations && invitations.length > 0 && (
        <PendingInvitations
          workspaceSlug={workspaceSegment}
          invitations={invitations}
          onRevoked={refreshInvitations}
        />
      )}

      <InviteDialog
        workspaceSlug={workspaceSegment}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => refreshInvitations()}
      />
    </SectionShell>
  );
}
