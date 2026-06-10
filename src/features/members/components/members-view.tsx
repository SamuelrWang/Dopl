"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { meetsMinRole } from "@/features/workspaces/types";
import type { MemberRole } from "../types";
import { useMembers } from "../hooks/use-members";
import { useInvitations } from "../hooks/use-invitations";
import { MembersTable } from "./members-table";
import { InviteDialog } from "./invite-dialog";
import { PendingInvitations } from "./pending-invitations";

interface Props {
  workspaceSlug: string;
  workspaceId: string;
  currentUserId: string;
  myRole: MemberRole;
}

/**
 * Members page shell. Single flat list (no teams) with an Invite button
 * for admins, a search + role-filter toolbar, and a pending-invitations
 * footer that only renders when the current user can manage the workspace.
 */
export function MembersView({ workspaceSlug, workspaceId, currentUserId, myRole }: Props) {
  const canManage = meetsMinRole(myRole, "admin");
  const [inviteOpen, setInviteOpen] = useState(false);

  const { members, loading, refresh: refreshMembers } = useMembers(workspaceSlug);
  const {
    invitations,
    refresh: refreshInvitations,
  } = useInvitations(workspaceSlug, canManage);

  const memberList = members ?? [];
  const inviteList = invitations ?? [];

  return (
    <>
      <PageTopBar
        title="Members"
        trailing={
          canManage && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border-default hover:bg-surface-raised-2 transition-colors text-xs text-text-primary cursor-pointer"
            >
              <Plus size={12} />
              Add member
            </button>
          )
        }
      />

      <div className="flex-1 min-h-0">
        <div className="h-full overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0">
              <MembersTable
                workspaceSlug={workspaceSlug}
                workspaceId={workspaceId}
                currentUserId={currentUserId}
                myRole={myRole}
                members={memberList}
                loading={loading}
                onChanged={refreshMembers}
              />
            </div>
            {canManage && inviteList.length > 0 && (
              <PendingInvitations
                workspaceSlug={workspaceSlug}
                invitations={inviteList}
                onRevoked={refreshInvitations}
              />
            )}
          </div>
        </div>
      </div>

      <InviteDialog
        workspaceSlug={workspaceSlug}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => {
          refreshInvitations();
          refreshMembers();
        }}
      />
    </>
  );
}
