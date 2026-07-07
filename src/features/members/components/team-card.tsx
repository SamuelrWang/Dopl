"use client";

import { AvatarStack } from "@/shared/ui/avatar-stack";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import type { WorkspaceMemberView } from "../types";
import { KebabMenu, ScopePill, TeamColorTile } from "./team-bits";

const GRANT_PREVIEW_MAX = 3;

interface Props {
  team: TeamView;
  members: WorkspaceMemberView[];
  resources: AccessMatrixResource[];
  canManage: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

/** Team card for the Teams tab grid: color tile, avatar stack, grant preview. */
export function TeamCard({
  team,
  members,
  resources,
  canManage,
  onOpen,
  onDelete,
}: Props) {
  const teamMembers = members.filter((m) => team.memberIds.includes(m.userId));
  const resourceName = (type: string, id: string) =>
    resources.find((r) => r.resourceType === type && r.resourceId === id)?.name;
  const grants = team.grants
    .map((g) => ({ ...g, name: resourceName(g.resourceType, g.resourceId) }))
    .filter((g): g is typeof g & { name: string } => Boolean(g.name));
  const shownGrants = grants.slice(0, GRANT_PREVIEW_MAX);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="rounded-xl border border-border-default bg-[var(--card-surface)] hover:border-border-strong hover:bg-[var(--card-surface-elevated)] transition-colors p-4 cursor-pointer text-left flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <TeamColorTile color={team.color} />
        <div className="flex-1 min-w-0">
          <p className="text-body font-medium text-text-primary truncate">{team.name}</p>
          {team.description && (
            <p className="text-caption text-text-muted truncate">
              {team.description}
            </p>
          )}
        </div>
        {canManage && (
          <KebabMenu
            ariaLabel={`Actions for ${team.name}`}
            items={[
              { label: "Open", onSelect: onOpen },
              { label: "Delete team", onSelect: onDelete, destructive: true },
            ]}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <AvatarStack
          users={teamMembers.map((m) => ({
            userId: m.userId,
            displayName: m.displayName ?? m.email ?? "?",
            avatarUrl: m.avatarUrl,
          }))}
        />
        <span className="text-caption text-text-muted">
          {team.memberCount} member{team.memberCount !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="border-t border-border-subtle pt-2.5 mt-auto">
        <h4 className="text-label font-mono uppercase tracking-wider text-text-muted mb-1.5">
          Resource access
        </h4>
        {shownGrants.length === 0 && (
          <p className="text-caption text-text-muted">No resources granted</p>
        )}
        <ul className="space-y-1">
          {shownGrants.map((g) => (
            <li
              key={`${g.resourceType}:${g.resourceId}`}
              className="flex items-center justify-between gap-2"
            >
              <span className="text-small text-text-secondary truncate">{g.name}</span>
              <ScopePill level={g.level} />
            </li>
          ))}
        </ul>
        {grants.length > GRANT_PREVIEW_MAX && (
          <p className="mt-1 text-micro font-mono text-text-muted">
            +{grants.length - GRANT_PREVIEW_MAX} more
          </p>
        )}
      </div>
    </div>
  );
}
