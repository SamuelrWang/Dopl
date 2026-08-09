"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { AssignableRole, WorkspaceInvitationView } from "../types";
import type { JoinRequestView } from "../hooks/use-join-requests";
import { Avatar, RoleSelect } from "./member-bits";

/**
 * The members list pane's two ADMIN QUEUES — pending join requests and
 * outstanding invitations — as label-strip groups above the roster.
 *
 * Extracted from `members-list-pane.tsx` (ENGINEERING §2: the pane crossed
 * the 500-line cap when the loading skeleton landed, and §2's rule is split
 * in the same change rather than trim a comment to buy the line back). They
 * are a real seam, not an arithmetic one: both render only for admins, both
 * are queues of things to ACT on rather than rows to select, and neither
 * touches the pane's selection/filter state.
 */

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

const DISABLED = "disabled:cursor-not-allowed disabled:opacity-40";

const GROUP_LABEL =
  "flex items-center gap-2 border-b border-border-subtle bg-card-surface-subtle px-3.5 py-1.5 text-label font-semibold uppercase tracking-wide text-text-secondary";

function GroupHead({ title, count }: { title: string; count: number }) {
  return (
    <div className={GROUP_LABEL}>
      {title}
      <span className="text-caption font-normal normal-case tracking-normal text-text-muted">
        {count}
      </span>
    </div>
  );
}

/**
 * `busy` is a SECOND-CLICK guard, not the feedback. Both queues resolve
 * optimistically — the acted-on row leaves in `onMutate`, which is what makes
 * the approve/decline pair un-double-fireable and what the revoke ✕ used to
 * produce nothing at all in place of. This only stops another row being fired
 * at while the first write is still settling.
 */
export function JoinRequestsGroup({
  requests,
  onResolve,
  busy = false,
}: {
  requests: JoinRequestView[];
  onResolve: (id: string, action: "approve" | "decline", role: AssignableRole) => void;
  busy?: boolean;
}) {
  const [roles, setRoles] = useState<Record<string, AssignableRole>>({});
  return (
    <div className="border-b border-border-subtle">
      <GroupHead title="Join requests" count={requests.length} />
      {requests.map((r) => (
        <div key={r.id} className="flex items-center gap-2 px-3.5 py-2">
          <Avatar
            person={{
              userId: r.userId,
              email: r.email,
              displayName: r.displayName,
              avatarUrl: r.avatarUrl,
            }}
            size="xs"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-semibold text-text-primary">
              {r.displayName || r.email || r.userId}
            </span>
            <span className="block truncate text-caption text-text-secondary">
              requested {formatRelativeTime(r.requestedAt)}
            </span>
          </span>
          <RoleSelect
            value={roles[r.id] ?? "member"}
            disabled={busy}
            onChange={(role) => setRoles((prev) => ({ ...prev, [r.id]: role }))}
          />
          <button
            type="button"
            aria-label="Approve"
            title="Approve"
            disabled={busy}
            onClick={() => onResolve(r.id, "approve", roles[r.id] ?? "member")}
            className={cn(ICON_BTN, DISABLED)}
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            aria-label="Decline"
            title="Decline"
            disabled={busy}
            onClick={() => onResolve(r.id, "decline", roles[r.id] ?? "member")}
            className={cn(ICON_BTN, DISABLED, "hover:text-danger")}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function InvitedGroup({
  invitations,
  onRevoke,
  busy = false,
}: {
  invitations: WorkspaceInvitationView[];
  onRevoke: (id: string) => void;
  busy?: boolean;
}) {
  return (
    <div className="border-b border-border-subtle">
      <GroupHead title="Invited" count={invitations.length} />
      {invitations.map((inv) => (
        <div key={inv.id} className="flex items-center gap-2 px-3.5 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-semibold text-text-primary">
              {inv.email}
            </span>
            <span className="block truncate text-caption text-text-secondary">
              {inv.invitedRole} · sent {formatRelativeTime(inv.createdAt)}
            </span>
          </span>
          <button
            type="button"
            aria-label={`Revoke invitation for ${inv.email}`}
            title="Revoke invitation"
            disabled={busy}
            onClick={() => onRevoke(inv.id)}
            className={cn(ICON_BTN, DISABLED, "hover:text-danger")}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
