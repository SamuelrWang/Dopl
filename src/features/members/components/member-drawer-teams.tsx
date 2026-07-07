"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Popover } from "@/shared/ui/popover-menu";
import type { AccessMatrixResource, TeamView } from "@/features/teams/types";
import { DEFAULT_TEAM_COLOR } from "../constants";
import { ScopePill } from "./team-bits";

interface Props {
  memberTeams: TeamView[];
  availableTeams: TeamView[];
  resources: AccessMatrixResource[];
  canManage: boolean;
  busy: boolean;
  onAddToTeam: (teamId: string) => void;
  onRemoveFromTeam: (teamId: string) => void;
}

/**
 * Member-drawer Teams section: each team is an expandable table row —
 * click drops down that team's scoping settings (its resource grants),
 * with the admin-only remove-from-team action in the expanded panel.
 */
export function MemberDrawerTeams({
  memberTeams,
  availableTeams,
  resources,
  canManage,
  busy,
  onAddToTeam,
  onRemoveFromTeam,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-label uppercase tracking-wider text-text-muted">
          Teams
        </h4>
        {canManage && availableTeams.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="flex items-center gap-1 text-caption text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              <Plus size={11} />
              Add to team
            </button>
            <Popover open={pickerOpen} onClose={() => setPickerOpen(false)} align="right" className="min-w-[170px]">
              {availableTeams.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPickerOpen(false);
                    onAddToTeam(t.id);
                  }}
                  className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-small text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary transition-colors cursor-pointer"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: t.color ?? DEFAULT_TEAM_COLOR }}
                  />
                  {t.name}
                </button>
              ))}
            </Popover>
          </div>
        )}
      </div>

      {memberTeams.length === 0 ? (
        <span className="text-caption text-text-muted">Not in any team</span>
      ) : (
        <ul className="rounded-lg border border-border-subtle divide-y divide-border-subtle overflow-hidden">
          {memberTeams.map((t) => (
            <TeamRow
              key={t.id}
              team={t}
              resources={resources}
              open={openTeamId === t.id}
              onToggle={() => setOpenTeamId(openTeamId === t.id ? null : t.id)}
              canManage={canManage}
              busy={busy}
              onRemove={() => onRemoveFromTeam(t.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamRow({
  team,
  resources,
  open,
  onToggle,
  canManage,
  busy,
  onRemove,
}: {
  team: TeamView;
  resources: AccessMatrixResource[];
  open: boolean;
  onToggle: () => void;
  canManage: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  // Resolve grant rows to display names; grants whose resource vanished
  // from the matrix (deleted, or hidden from the caller) are skipped.
  const grantRows = team.grants.flatMap((g) => {
    const resource = resources.find(
      (r) => r.resourceType === g.resourceType && r.resourceId === g.resourceId
    );
    return resource ? [{ ...g, name: resource.name }] : [];
  });

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised-1 transition-colors cursor-pointer"
      >
        <ChevronRight
          size={11}
          className={cn(
            "shrink-0 text-text-muted transition-transform",
            open && "rotate-90"
          )}
        />
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: team.color ?? DEFAULT_TEAM_COLOR }}
        />
        <span className="flex-1 min-w-0 truncate text-small text-text-primary">
          {team.name}
        </span>
        <span className="shrink-0 text-micro text-text-muted">
          {grantRows.length === 0
            ? "No scoping"
            : `${grantRows.length} scoped`}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2.5 bg-surface-raised-1 border-t border-border-subtle">
          {grantRows.length === 0 ? (
            <p className="pt-2 text-caption text-text-muted">
              No scoped resources — this team only sees workspace-wide items.
            </p>
          ) : (
            <ul className="pt-1.5 space-y-1">
              {grantRows.map((g) => (
                <li
                  key={`${g.resourceType}:${g.resourceId}`}
                  className="flex items-center justify-between gap-3 py-1"
                >
                  <div className="min-w-0">
                    <p className="text-small text-text-primary truncate">{g.name}</p>
                    <p className="text-micro text-text-muted">
                      {g.resourceType === "knowledge_base"
                        ? "Knowledge base"
                        : "Workflow"}
                    </p>
                  </div>
                  <ScopePill level={g.level} />
                </li>
              ))}
            </ul>
          )}
          {canManage && (
            <button
              type="button"
              disabled={busy}
              onClick={onRemove}
              className="mt-2 text-caption text-danger hover:text-danger transition-colors cursor-pointer disabled:opacity-60"
            >
              Remove from this team
            </button>
          )}
        </div>
      )}
    </li>
  );
}
