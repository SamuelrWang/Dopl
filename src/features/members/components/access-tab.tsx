"use client";

import { useState } from "react";
import { BookOpen, Globe, Workflow } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import {
  TeamAccessConflictError,
  setResourceAccessMode,
  setTeamGrant,
} from "../teams-client";
import type { ConflictState } from "./conflict-dialog";
import { ScopePill } from "./team-bits";

interface Props {
  workspaceSlug: string;
  teams: TeamView[];
  resources: AccessMatrixResource[];
  canManage: boolean;
  onTeamsChanged: () => void;
  openConflict: (conflict: ConflictState) => void;
}

const NEXT_LEVEL: Record<string, AccessLevel | null> = {
  none: "read",
  read: "edit",
  edit: null,
};

/**
 * Access matrix: teams as rows, resources as columns (grouped into
 * knowledge bases and workflows). Cells cycle none → read → edit on
 * click (admin only). The scope row at the top toggles each resource
 * between workspace-wide and teams-only access.
 */
export function AccessTab({
  workspaceSlug,
  teams,
  resources,
  canManage,
  onTeamsChanged,
  openConflict,
}: Props) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kbs = resources.filter((r) => r.resourceType === "knowledge_base");
  const wfs = resources.filter((r) => r.resourceType === "workflow");
  const ordered = [...kbs, ...wfs];

  const grantFor = (
    team: TeamView,
    type: TeamResourceType,
    id: string
  ): AccessLevel | null =>
    team.grants.find((g) => g.resourceType === type && g.resourceId === id)
      ?.level ?? null;

  async function run(key: string, fn: (autoGrant: boolean) => Promise<void>) {
    setBusyKey(key);
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
      setBusyKey(null);
    }
  }

  function cycleCell(team: TeamView, r: AccessMatrixResource) {
    if (!canManage) return;
    const current = grantFor(team, r.resourceType, r.resourceId);
    const next = NEXT_LEVEL[current ?? "none"];
    void run(`${team.id}:${r.resourceId}`, (autoGrant) =>
      setTeamGrant(workspaceSlug, team.id, r.resourceType, r.resourceId, next, {
        autoGrant,
      })
    );
  }

  function toggleScope(r: AccessMatrixResource) {
    if (!canManage) return;
    const next = r.accessMode === "workspace" ? "teams" : "workspace";
    void run(`scope:${r.resourceId}`, (autoGrant) =>
      setResourceAccessMode(workspaceSlug, r.resourceType, r.resourceId, next, {
        autoGrant,
      })
    );
  }

  if (resources.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-body text-text-muted">
        No knowledge bases or workflows yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-text-tertiary max-w-2xl">
        Members inherit the highest access level from any team they belong to.
        Workspace-wide resources are open to every member at their role&apos;s
        default level; teams-only resources are visible to granted teams (plus
        admins and the creator). Click a cell to cycle its level.
      </p>
      {error && <p className="text-small text-danger">{error}</p>}

      <div className="rounded-xl border border-border-default bg-[var(--card-surface)] overflow-x-auto">
      <table className="w-max min-w-full text-left">
        <thead>
          <tr className="border-b border-border-subtle">
            <th className="sticky left-0 bg-[var(--card-surface)] px-4 py-2 text-label font-mono uppercase tracking-wider text-text-muted font-normal min-w-[160px]">
              Team
            </th>
            {ordered.map((r) => (
              <th
                key={r.resourceId}
                className="px-3 py-2 font-normal min-w-[130px] align-bottom"
              >
                <span className="flex items-center gap-1 text-label font-mono uppercase tracking-wider text-text-muted">
                  {r.resourceType === "knowledge_base" ? (
                    <BookOpen size={10} />
                  ) : (
                    <Workflow size={10} />
                  )}
                  <span className="truncate max-w-[110px]" title={r.name}>
                    {r.name}
                  </span>
                </span>
              </th>
            ))}
          </tr>
          <tr className="border-b border-border-subtle">
            <th className="sticky left-0 bg-[var(--card-surface)] px-4 py-2 text-label font-mono uppercase tracking-wider text-text-secondary/40 font-normal">
              Scope
            </th>
            {ordered.map((r) => (
              <th key={r.resourceId} className="px-3 py-2 font-normal">
                <button
                  type="button"
                  disabled={!canManage || busyKey === `scope:${r.resourceId}`}
                  onClick={() => toggleScope(r)}
                  title={
                    r.accessMode === "workspace"
                      ? "Workspace-wide — click to restrict to teams"
                      : "Teams only — click to open to the whole workspace"
                  }
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-label font-mono uppercase tracking-wider border transition-colors",
                    r.accessMode === "workspace"
                      ? "bg-surface-raised-1 border-border-subtle text-text-muted"
                      : "bg-bg-inset border-border-strong text-text-primary",
                    canManage
                      ? "cursor-pointer hover:brightness-110"
                      : "cursor-default"
                  )}
                >
                  <Globe size={9} />
                  {r.accessMode === "workspace" ? "Everyone" : "Teams"}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {teams.length === 0 && (
            <tr>
              <td
                colSpan={ordered.length + 1}
                className="px-4 py-8 text-center text-body text-text-muted"
              >
                No teams yet — create one to start granting access.
              </td>
            </tr>
          )}
          {teams.map((team) => (
            <tr key={team.id} className="hover:bg-surface-raised-1 transition-colors">
              <td className="sticky left-0 bg-[var(--card-surface)] px-4 py-2.5">
                <span className="flex items-center gap-2 text-small text-text-primary">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: team.color ?? "#8b5cf6" }}
                  />
                  <span className="truncate max-w-[130px]">{team.name}</span>
                  <span className="text-micro font-mono text-text-muted">
                    {team.memberCount}
                  </span>
                </span>
              </td>
              {ordered.map((r) => {
                const disabled =
                  !canManage ||
                  r.accessMode === "workspace" ||
                  busyKey === `${team.id}:${r.resourceId}`;
                return (
                  <td key={r.resourceId} className="px-3 py-2.5">
                    {r.accessMode === "workspace" ? (
                      <span
                        className="text-micro font-mono text-text-secondary/40"
                        title="Workspace-wide — grants don't apply"
                      >
                        —
                      </span>
                    ) : (
                      <ScopePill
                        level={grantFor(team, r.resourceType, r.resourceId)}
                        disabled={disabled}
                        onClick={
                          canManage ? () => cycleCell(team, r) : undefined
                        }
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
