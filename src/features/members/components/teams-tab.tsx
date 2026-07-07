"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import type { WorkspaceMemberView } from "../types";
import { deleteTeam } from "../teams-client";
import type { ConflictState } from "./conflict-dialog";
import { TeamCard } from "./team-card";
import { TeamDrawer } from "./team-drawer";

interface Props {
  workspaceSlug: string;
  teams: TeamView[];
  members: WorkspaceMemberView[];
  resources: AccessMatrixResource[];
  loading: boolean;
  canManage: boolean;
  onTeamsChanged: () => void;
  onCreateTeam: () => void;
  openConflict: (conflict: ConflictState) => void;
}

/** Teams tab: responsive card grid + dashed create tile + team drawer. */
export function TeamsTab({
  workspaceSlug,
  teams,
  members,
  resources,
  loading,
  canManage,
  onTeamsChanged,
  onCreateTeam,
  openConflict,
}: Props) {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamView | null>(null);
  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

  return (
    <div>
      {loading && teams.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-44 rounded-xl border border-border-subtle bg-surface-raised-1 animate-pulse"
            />
          ))}
        </div>
      )}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              members={members}
              resources={resources}
              canManage={canManage}
              onOpen={() => setSelectedTeamId(team.id)}
              onDelete={() => setDeleteTarget(team)}
            />
          ))}
          {canManage && (
            <button
              type="button"
              onClick={onCreateTeam}
              className="rounded-xl border border-dashed border-border-default hover:border-border-strong hover:bg-surface-raised-1 transition-colors flex flex-col items-center justify-center gap-2 text-text-muted hover:text-text-primary min-h-[176px] cursor-pointer"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-raised-2">
                <Plus size={16} />
              </span>
              <span className="text-small">Create a team</span>
            </button>
          )}
          {!canManage && teams.length === 0 && (
            <p className="col-span-full px-4 py-10 text-center text-body text-text-muted">
              No teams yet.
            </p>
          )}
        </div>
      )}

      <TeamDrawer
        workspaceSlug={workspaceSlug}
        team={selectedTeam}
        members={members}
        resources={resources}
        canManage={canManage}
        onClose={() => setSelectedTeamId(null)}
        onTeamsChanged={onTeamsChanged}
        onDelete={() => {
          if (selectedTeam) setDeleteTarget(selectedTeam);
        }}
        openConflict={openConflict}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete team?"
        description={
          deleteTarget
            ? `“${deleteTarget.name}” and its access grants will be removed. Members keep their workspace accounts, but lose any access this team granted.`
            : ""
        }
        confirmLabel="Delete team"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteTeam(workspaceSlug, deleteTarget.id);
          if (selectedTeamId === deleteTarget.id) setSelectedTeamId(null);
          onTeamsChanged();
        }}
      />
    </div>
  );
}
