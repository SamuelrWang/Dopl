"use client";

import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import {
  formatLastActive,
  formatRelativeTime,
  formatShortDate,
} from "@/shared/lib/format-time";
import type { AssignableRole, WorkspaceInvitationView, WorkspaceMemberView } from "../../types";
import type { JoinRequestView } from "../../hooks/use-join-requests";
import { RoleSelect } from "../member-bits";
import {
  ColumnLabel,
  IconButton,
  OwnerPill,
  PresenceDot,
  SECTION_CARD,
  StateChip,
  ZEBRA_ROW,
} from "./bits";
import { displayNameOf } from "./view-model";

const GRID_ADMIN = "grid grid-cols-[minmax(0,1fr)_78px_44px] items-center gap-2.5 px-3";
const GRID_PLAIN = "grid grid-cols-[minmax(0,1fr)_78px] items-center gap-2.5 px-3";
const ROW_BORDER = "border-b border-border-subtle last:border-b-0";

function HeaderStrip({
  grid,
  showActions,
  secondColumn,
}: {
  grid: string;
  showActions: boolean;
  secondColumn: string;
}) {
  return (
    <div className={cn(grid, "h-8 border-b border-border-default bg-card-surface-subtle")}>
      <ColumnLabel>Name</ColumnLabel>
      <ColumnLabel>{secondColumn}</ColumnLabel>
      {showActions && <span />}
    </div>
  );
}

export function MemberSectionCard({
  members,
  openUserId,
  showRowActions,
  canSeePresence,
  busy,
  onOpen,
  onRemove,
}: {
  members: WorkspaceMemberView[];
  openUserId: string | null;
  showRowActions: boolean;
  /** ⚠ Same rule as the detail header (`visibility.ts › showPresence`): a peer
   *  gets identity, not a read on when somebody was last at their desk. */
  canSeePresence: (userId: string) => boolean;
  busy: boolean;
  onOpen: (userId: string) => void;
  onRemove: (member: WorkspaceMemberView) => void;
}) {
  const grid = showRowActions ? GRID_ADMIN : GRID_PLAIN;
  return (
    <div className={SECTION_CARD}>
      <HeaderStrip grid={grid} showActions={showRowActions} secondColumn="Joined" />
      {members.map((m) => {
        const showPresence = canSeePresence(m.userId);
        const activity = showPresence
          ? formatLastActive(m.lastSeenAt, m.status, m.invitedAt)
          : null;
        const open = m.userId === openUserId;
        return (
          <div
            key={m.userId}
            className={cn(
              grid,
              ROW_BORDER,
              "group relative py-2",
              // The zebra tint is an `odd:` variant and out-specifies a plain
              // `bg-*`, so the open row drops striping rather than painting over.
              open ? "bg-surface-raised-3" : cn(ZEBRA_ROW, "hover:bg-surface-raised-1")
            )}
          >
            {open && (
              <span
                aria-hidden
                className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-[3px] bg-text-primary"
              />
            )}
            <button
              type="button"
              onClick={() => onOpen(m.userId)}
              aria-current={open ? "true" : undefined}
              className="flex min-w-0 cursor-pointer items-center gap-2.5 text-left"
            >
              <Avatar person={m} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-body font-medium text-text-primary">
                    {displayNameOf(m)}
                  </span>
                  {m.role === "owner" && <OwnerPill />}
                </span>
                <span className="flex items-center gap-1.5 text-caption text-text-secondary">
                  {activity && <PresenceDot dot={activity.dot} />}
                  <span className="min-w-0 truncate">
                    {m.email ?? ""}
                    {activity ? `${m.email ? " · " : ""}${activity.label}` : ""}
                  </span>
                </span>
              </span>
            </button>

            <span className="truncate text-caption text-text-secondary">
              {formatShortDate(m.joinedAt)}
            </span>

            {showRowActions && (
              <span className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <IconButton
                  icon={Trash2}
                  label={`Remove ${displayNameOf(m)}`}
                  size={13}
                  disabled={busy}
                  onClick={() => onRemove(m)}
                />
                <IconButton
                  icon={Pencil}
                  label={`Open ${displayNameOf(m)}`}
                  size={13}
                  onClick={() => onOpen(m.userId)}
                />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Pending: outstanding invitations and join requests.
 *
 * ⚠ An invitation is NOT a member row — `workspace_invitations` is keyed by
 * EMAIL and has no `userId`, no teams and no presence. Nothing here opens a
 * detail pane, because there is no member to open.
 */
export function PendingSectionCard({
  invitations,
  joinRequests,
  showRowActions,
  busy,
  onRevokeInvitation,
  onResolveJoinRequest,
}: {
  invitations: WorkspaceInvitationView[];
  joinRequests: JoinRequestView[];
  showRowActions: boolean;
  busy: boolean;
  onRevokeInvitation: (id: string) => void;
  onResolveJoinRequest: (
    id: string,
    action: "approve" | "decline",
    role: AssignableRole
  ) => void;
}) {
  return (
    <div className={SECTION_CARD}>
      <HeaderStrip grid={GRID_PLAIN} showActions={false} secondColumn={showRowActions ? "Actions" : ""} />

      {invitations.map((inv) => (
        <div key={inv.id} className={cn(GRID_PLAIN, ROW_BORDER, ZEBRA_ROW, "py-2")}>
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar
              person={{ userId: inv.id, email: inv.email, displayName: null, avatarUrl: null }}
              size="sm"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 truncate text-body font-medium text-text-primary">
                  {inv.email}
                </span>
                <StateChip label="Invited" />
              </span>
              <span className="flex items-center gap-1.5 text-caption text-text-secondary">
                <PresenceDot dot="invited" />
                <span className="min-w-0 truncate">
                  {inv.invitedRole} · sent {formatRelativeTime(inv.createdAt)}
                </span>
              </span>
            </span>
          </span>
          {showRowActions ? (
            <span className="flex items-center justify-end">
              <IconButton
                icon={X}
                label={`Revoke invitation for ${inv.email}`}
                size={13}
                disabled={busy}
                onClick={() => onRevokeInvitation(inv.id)}
              />
            </span>
          ) : (
            <span className="text-caption text-text-secondary">—</span>
          )}
        </div>
      ))}

      {joinRequests.map((r) => (
        <JoinRequestRow
          key={r.id}
          request={r}
          showRowActions={showRowActions}
          busy={busy}
          onResolve={onResolveJoinRequest}
        />
      ))}
    </div>
  );
}

function JoinRequestRow({
  request: r,
  showRowActions,
  busy,
  onResolve,
}: {
  request: JoinRequestView;
  showRowActions: boolean;
  busy: boolean;
  onResolve: (id: string, action: "approve" | "decline", role: AssignableRole) => void;
}) {
  const name = r.displayName || r.email || r.userId;
  return (
    <div className={cn(GRID_PLAIN, ROW_BORDER, ZEBRA_ROW, "py-2")}>
      <span className="flex min-w-0 items-center gap-2.5">
        <Avatar person={r} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-body font-medium text-text-primary">
              {name}
            </span>
            <StateChip label="Join request" />
          </span>
          <span className="flex items-center gap-1.5 text-caption text-text-secondary">
            <PresenceDot dot="invited" />
            <span className="min-w-0 truncate">
              asked {formatRelativeTime(r.requestedAt)}
            </span>
          </span>
        </span>
      </span>
      {showRowActions ? (
        <JoinRequestActions
          busy={busy}
          onApprove={(role) => onResolve(r.id, "approve", role)}
          onDecline={() => onResolve(r.id, "decline", "member")}
        />
      ) : (
        <span className="text-caption text-text-secondary">—</span>
      )}
    </div>
  );
}

/** Role is chosen on the row, then approved — the shipping queue's shape.
 *  ⚠ Only the owner may approve as admin; `RoleSelect` offers it and the server
 *  refuses it (`canGrantRole` in `resolveJoinRequest`). */
function JoinRequestActions({
  busy,
  onApprove,
  onDecline,
}: {
  busy: boolean;
  onApprove: (role: AssignableRole) => void;
  onDecline: () => void;
}) {
  const [role, setRole] = useState<AssignableRole>("member");
  return (
    <span className="flex items-center justify-end gap-1">
      <RoleSelect value={role} onChange={setRole} disabled={busy} />
      <IconButton
        icon={Check}
        label={`Approve as ${role}`}
        size={13}
        disabled={busy}
        onClick={() => onApprove(role)}
      />
      <IconButton icon={X} label="Decline" size={13} disabled={busy} onClick={onDecline} />
    </span>
  );
}
