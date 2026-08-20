"use client";

import { Plus, UsersRound } from "lucide-react";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { EmptyState } from "@/shared/ui/empty-state";
import { cn } from "@/shared/lib/utils";
import type { TeamView } from "@/features/teams/types";
import type { WorkspaceMemberView } from "../../types";
import { TeamColorTile } from "../team-bits";
import { scopedResourceCount } from "../member-bits";
import { SECTION_CARD, ZEBRA_ROW } from "./bits";
import { displayNameOf } from "./view-model";

export function TeamsList({
  query,
  teams,
  members,
  openTeamId,
  canManageTeams,
  onOpen,
  onCreate,
}: {
  query: string;
  teams: TeamView[];
  members: WorkspaceMemberView[];
  openTeamId: string | null;
  canManageTeams: boolean;
  onOpen: (teamId: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5 px-3 pb-6">
      {canManageTeams && (
        <button
          type="button"
          onClick={onCreate}
          className="btn-light flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] text-small font-medium text-text-primary"
        >
          <Plus size={13} aria-hidden />
          Create team
        </button>
      )}

      {teams.length === 0 ? (
        <div className="py-12">
          <EmptyState
            icon={UsersRound}
            title={query.trim() ? "No teams match." : "No teams yet."}
            description={
              query.trim()
                ? `Nothing answers to “${query.trim()}”.`
                : "Teams scope access to knowledge bases, skills and chats."
            }
          />
        </div>
      ) : (
        <div className={SECTION_CARD}>
          {teams.map((team) => {
            const open = team.id === openTeamId;
            // ⚠ Counted through the shared helper so this caption cannot claim
            // more resources than the team pane will list.
            const scoped = scopedResourceCount(team);
            const stack = team.memberIds
              .map((id) => members.find((m) => m.userId === id))
              .filter((m): m is WorkspaceMemberView => Boolean(m))
              .map((m) => ({
                userId: m.userId,
                displayName: displayNameOf(m),
                avatarUrl: m.avatarUrl,
              }));

            return (
              <button
                key={team.id}
                type="button"
                onClick={() => onOpen(team.id)}
                aria-current={open ? "true" : undefined}
                className={cn(
                  "relative flex w-full cursor-pointer items-center gap-2.5 border-b border-border-subtle px-3 py-2.5 text-left last:border-b-0",
                  open
                    ? "bg-surface-raised-3"
                    : cn(ZEBRA_ROW, "hover:bg-surface-raised-1")
                )}
              >
                {open && (
                  <span
                    aria-hidden
                    className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-[3px] bg-text-primary"
                  />
                )}
                <TeamColorTile color={team.color} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-text-primary">
                    {team.name}
                  </span>
                  <span className="block truncate text-caption text-text-secondary">
                    {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
                    {" · "}
                    {scoped === 0
                      ? "no scoped resources"
                      : `${scoped} scoped ${scoped === 1 ? "resource" : "resources"}`}
                  </span>
                </span>
                <span className="shrink-0">
                  <AvatarStack users={stack} max={3} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
