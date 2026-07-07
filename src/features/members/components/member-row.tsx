"use client";

import { cn } from "@/shared/lib/utils";
import type { AssignableRole, WorkspaceMemberView } from "../types";
import { formatLastActive, type ActivityDot } from "../format-last-active";
import { Avatar, RolePill, RoleSelect } from "./member-bits";
import { KebabMenu, TeamChip } from "./team-bits";

export const MEMBER_ROW_GRID =
  "grid grid-cols-[minmax(200px,1.4fr)_110px_minmax(150px,1fr)_130px_32px] items-center gap-3 px-4 py-3";

const DOT_STYLE: Record<ActivityDot, string> = {
  active: "bg-success",
  idle: "bg-surface-raised-4 ring-1 ring-border-default",
  invited: "bg-warning",
  deactivated: "bg-danger/60",
};

interface Props {
  member: WorkspaceMemberView;
  isSelf: boolean;
  canManage: boolean;
  canEditTarget: boolean;
  /** Whether clicking the row opens the detail drawer (admins see
   *  everyone; regular members only themselves). */
  clickable: boolean;
  busy: boolean;
  onOpen: () => void;
  onChangeRole: (role: AssignableRole) => void;
  onRemove: () => void;
}

/**
 * One members-table row: avatar · role · team chips · last active ·
 * kebab. Clicking the row opens the member detail drawer (when allowed).
 */
export function MemberRow({
  member: m,
  isSelf,
  canManage,
  canEditTarget,
  clickable,
  busy,
  onOpen,
  onChangeRole,
  onRemove,
}: Props) {
  const activity = formatLastActive(m.lastSeenAt, m.status, m.invitedAt);
  const chips = m.teams.slice(0, 2);
  const extraChips = m.teams.length - chips.length;
  const kebabItems = [
    ...(clickable ? [{ label: "View details", onSelect: onOpen }] : []),
    ...(canManage && !isSelf && m.role !== "owner"
      ? [
          {
            label: "Remove from workspace",
            onSelect: onRemove,
            destructive: true,
          },
        ]
      : []),
  ];

  return (
    <div
      {...(clickable
        ? {
            onClick: onOpen,
            role: "button" as const,
            tabIndex: 0,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen();
              }
            },
          }
        : {})}
      className={cn(
        MEMBER_ROW_GRID,
        clickable && "cursor-pointer hover:bg-surface-raised-1 transition-colors"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Avatar person={m} />
        <div className="min-w-0">
          <p className="text-body text-text-primary truncate">
            {m.displayName || m.email || m.userId}
            {isSelf && (
              <span className="ml-2 text-label uppercase tracking-wider text-text-muted">
                You
              </span>
            )}
          </p>
          {m.email && m.displayName && (
            <p className="text-caption text-text-muted truncate">
              {m.email}
            </p>
          )}
        </div>
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        {canEditTarget ? (
          <RoleSelect
            value={m.role as AssignableRole}
            disabled={busy}
            onChange={onChangeRole}
          />
        ) : (
          <RolePill role={m.role} />
        )}
      </div>

      <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
        {chips.length === 0 && (
          <span className="text-caption text-text-muted">No team</span>
        )}
        {chips.map((t) => (
          <TeamChip key={t.teamId} name={t.name} color={t.color} />
        ))}
        {extraChips > 0 && (
          <span className="text-micro font-mono text-text-muted">
            +{extraChips}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-caption font-mono text-text-muted">
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_STYLE[activity.dot])}
        />
        <span className="truncate">{activity.label}</span>
      </div>

      <div className="flex justify-end">
        {kebabItems.length > 0 && (
          <KebabMenu
            ariaLabel={`Actions for ${m.displayName || m.email || "member"}`}
            items={kebabItems}
          />
        )}
      </div>
    </div>
  );
}
