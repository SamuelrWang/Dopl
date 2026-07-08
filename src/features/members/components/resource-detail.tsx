"use client";

import { useState } from "react";
import { BookOpen, ChevronRight, Workflow } from "lucide-react";
import { SectionBox } from "@/shared/ui/section-box";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import type { AccessLevel } from "@/features/teams/access-levels";
import { DEFAULT_TEAM_COLOR } from "../constants";
import {
  TeamAccessConflictError,
  setResourceAccessMode,
  setTeamGrant,
} from "../teams-client";
import type { ConflictState } from "./conflict-dialog";
import { AccessLevelControl, ScopePill } from "./team-bits";

interface Props {
  workspaceSlug: string;
  resource: AccessMatrixResource;
  teams: TeamView[];
  canManage: boolean;
  onTeamsChanged: () => void;
  openConflict: (conflict: ConflictState) => void;
}

/**
 * Resource detail — the Access tab's right pane. Resource-centric
 * replacement for the old horizontal-scroll matrix table: one resource,
 * its workspace/teams scope control, and a per-team access list.
 */
export function ResourceDetail({
  workspaceSlug,
  resource: r,
  teams,
  canManage,
  onTeamsChanged,
  openConflict,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const Icon = r.resourceType === "knowledge_base" ? BookOpen : Workflow;
  const typeLabel = r.resourceType === "knowledge_base" ? "Knowledge base" : "Workflow";

  const grantFor = (team: TeamView): AccessLevel | null =>
    team.grants.find(
      (g) => g.resourceType === r.resourceType && g.resourceId === r.resourceId
    )?.level ?? null;

  async function run(fn: (autoGrant: boolean) => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn(false);
      onTeamsChanged();
    } catch (err) {
      if (err instanceof TeamAccessConflictError) {
        openConflict({
          details: err.details,
          retry: async () => {
            await fn(true);
            onTeamsChanged();
          },
        });
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  }

  function changeScope(next: "workspace" | "teams") {
    if (!canManage || next === r.accessMode) return;
    void run((autoGrant) =>
      setResourceAccessMode(workspaceSlug, r.resourceType, r.resourceId, next, {
        autoGrant,
      })
    );
  }

  function changeGrant(team: TeamView, level: AccessLevel | null) {
    void run((autoGrant) =>
      setTeamGrant(workspaceSlug, team.id, r.resourceType, r.resourceId, level, {
        autoGrant,
      })
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-border-default px-3.5">
        <span className="shrink-0 text-small font-medium text-text-secondary">
          Access
        </span>
        <ChevronRight size={13} className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate text-lead font-semibold text-text-primary">
          {r.name}
        </span>
        <span className="flex-1" />
        {canManage && (
          <SegmentedControl
            options={[
              { key: "workspace" as const, label: "Everyone" },
              { key: "teams" as const, label: "Teams" },
            ]}
            value={r.accessMode}
            onChange={changeScope}
            className="w-[190px]"
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-14 pb-16 pt-8">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          <section className="flex items-center gap-4 rounded-[14px] border border-border-strong bg-bg-elevated px-5 py-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-inset text-text-secondary">
              <Icon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-display font-semibold tracking-tight text-text-primary">
                {r.name}
              </h2>
              <p className="mt-1 text-caption text-text-secondary">
                {typeLabel} ·{" "}
                {r.accessMode === "workspace"
                  ? "workspace-wide — every member has access at their role's default level"
                  : "teams-only — visible to granted teams, admins, and the creator"}
              </p>
            </div>
          </section>

          {error && <p className="text-caption text-danger">{error}</p>}

          <SectionBox
            label="Team access"
            meta={
              r.accessMode === "workspace"
                ? "grants don't apply while workspace-wide"
                : undefined
            }
          >
            {teams.length === 0 ? (
              <p className="px-4 py-3 text-caption text-text-muted">
                No teams yet — create one from the Teams tab to scope access.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {teams.map((team) => (
                  <li
                    key={team.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: team.color ?? DEFAULT_TEAM_COLOR }}
                      />
                      <span className="min-w-0 truncate text-body text-text-primary">
                        {team.name}
                      </span>
                      <span className="shrink-0 text-micro text-text-muted">
                        {team.memberCount}
                      </span>
                    </span>
                    {r.accessMode === "workspace" ? (
                      <span
                        className="text-micro text-text-muted"
                        title="Workspace-wide — grants don't apply"
                      >
                        —
                      </span>
                    ) : canManage ? (
                      <AccessLevelControl
                        value={grantFor(team)}
                        disabled={busy}
                        onChange={(level) => changeGrant(team, level)}
                      />
                    ) : (
                      <ScopePill level={grantFor(team)} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionBox>
        </div>
      </div>
    </div>
  );
}
