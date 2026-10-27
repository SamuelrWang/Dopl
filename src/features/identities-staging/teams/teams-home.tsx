"use client";

import { useState } from "react";
import { Users } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { CreateButton } from "@/shared/ui/pill-button";
import { toast } from "@/shared/ui/toast";
import { IdentityRailResizeHandle } from "@/features/agent-identities/components/identity-rail-resize";
import {
  IDENTITY_GRID_RAIL,
  IdentityPanel,
} from "@/features/agent-identities/components/identity-section";
import {
  SECTIONS_CONTAINER,
  SECTION_PRIVATE_EVERYWHERE,
} from "@/features/agent-identities/lib/visibility";
import { nameOf } from "../data-agents";
import { latency } from "../store/identity-store";
import {
  SEED_AGENT_TEAMS,
  SEED_TEAM_RUN,
  type StagingAgentTeam,
  type StagingTeamRun,
} from "../data/agent-teams";
import { TeamCard, type TeamLaunchState } from "./team-card";
import { TeamDetailDialog } from "./team-detail-dialog";
import { TeamEditorDialog } from "./team-editor-dialog";
import { startRun } from "./team-model";
import { TeamRunGroup } from "./team-run-group";

/**
 * STAGING MOCKUP of the Identities page's Teams view (PROPOSAL §2): the identity face's two
 * sections holding team cards, the same Activity rail showing each launched team as one group,
 * a read-only team view and a staged editor. Everything is local state.
 */
export function TeamsHome({
  channelName,
  currentUserId,
  viewerPhoto,
}: {
  /** `null` = no channel selected: no shared section, nothing to launch into. */
  channelName: string | null;
  currentUserId: string;
  viewerPhoto: string | null;
}) {
  const [teams, setTeams] = useState<StagingAgentTeam[]>(SEED_AGENT_TEAMS);
  const [runs, setRuns] = useState<StagingTeamRun[]>([SEED_TEAM_RUN]);
  const [starting, setStarting] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ team: StagingAgentTeam | null } | null>(null);

  const shared = teams.filter((t) => t.scope === "shared");
  const personal = teams.filter((t) => t.scope === "home");
  const viewing = teams.find((t) => t.id === viewingId);
  const markerFor = (team: StagingAgentTeam) =>
    team.createdBy === currentUserId ? null : `by ${nameOf(team.createdBy) ?? "a member"}`;
  const scopeLabel = (team: StagingAgentTeam) =>
    team.scope === "shared" ? SECTIONS_CONTAINER[0].label : SECTION_PRIVATE_EVERYWHERE.label;
  const launchState = (team: StagingAgentTeam): TeamLaunchState | null => {
    if (!channelName) return null;
    if (starting === team.id) return "starting";
    return runs.some((r) => r.teamId === team.id) ? "running" : "idle";
  };

  async function launch(team: StagingAgentTeam, templateId = team.templates[0]?.id) {
    if (!channelName || !templateId) return;
    setStarting(team.id);
    await latency(900);
    setStarting(null);
    setRuns((all) => [startRun(team, templateId, channelName), ...all.filter((r) => r.teamId !== team.id)]);
    const template = team.templates.find((t) => t.id === templateId);
    toast({
      title: `"${team.name}" launched into #${channelName}: ${template?.title ?? "run"}`,
      variant: "invert",
    });
  }

  const grid = (rows: StagingAgentTeam[], emptyLine: string) =>
    rows.length === 0 ? (
      <p className="pb-1 text-caption text-text-muted">{emptyLine}</p>
    ) : (
      <div className={IDENTITY_GRID_RAIL}>
        {rows.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            marker={markerFor(team)}
            launch={launchState(team)}
            onOpen={() => setViewingId(team.id)}
            onLaunch={() => void launch(team)}
          />
        ))}
      </div>
    );

  return (
    <div className="rail-layout">
      <div className="rail-layout-cols">
        <div className="rail-layout-main">
          <div className="flex min-w-0 flex-wrap items-center gap-4">
            <p className="flex-none text-caption text-text-muted">
              {teams.length} agent {teams.length === 1 ? "team" : "teams"}
            </p>
            <div className="ml-auto flex-none">
              <CreateButton onClick={() => setEditing({ team: null })}>Agent team</CreateButton>
            </div>
          </div>

          {channelName === null ? (
            <EmptyState icon={Users} title="No channel selected" />
          ) : (
            <IdentityPanel id="home-teams-shared" label={SECTIONS_CONTAINER[0].label} flat>
              {grid(shared, "No agent teams shared in this channel yet.")}
            </IdentityPanel>
          )}
          <IdentityPanel id="home-teams-private" label={SECTION_PRIVATE_EVERYWHERE.label} flat>
            {grid(personal, "You haven't made an agent team yet.")}
          </IdentityPanel>
        </div>

        <IdentityRailResizeHandle />
        <aside className="rail-layout-aside" aria-label="Activity">
          <IdentityPanel id="home-teams-activity" label="Activity" flat>
            {runs.length === 0 ? (
              <p className="pb-1 text-caption text-text-muted">No agent teams running right now.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {runs.map((run) => {
                  const team = teams.find((t) => t.id === run.teamId);
                  return (
                    team && (
                      <TeamRunGroup
                        key={run.teamId}
                        team={team}
                        run={run}
                        ownerPhoto={viewerPhoto}
                        onOpen={() => setViewingId(team.id)}
                      />
                    )
                  );
                })}
              </div>
            )}
          </IdentityPanel>
        </aside>
      </div>

      {viewing && (
        <TeamDetailDialog
          team={viewing}
          marker={markerFor(viewing)}
          scopeLabel={scopeLabel(viewing)}
          canLaunch={channelName !== null}
          onLaunch={(templateId) => {
            setViewingId(null);
            void launch(viewing, templateId);
          }}
          onEdit={() => {
            setViewingId(null);
            setEditing({ team: viewing });
          }}
          onClose={() => setViewingId(null)}
        />
      )}
      {editing && (
        <TeamEditorDialog
          team={editing.team}
          createdBy={currentUserId}
          onClose={() => setEditing(null)}
          onSave={(saved) => {
            setTeams((all) =>
              all.some((t) => t.id === saved.id)
                ? all.map((t) => (t.id === saved.id ? saved : t))
                : [...all, saved]
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
