"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
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
        <h4 className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
          Teams
        </h4>
        {canManage && availableTeams.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              <Plus size={11} />
              Add to team
            </button>
            {pickerOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setPickerOpen(false)}
                  aria-hidden
                />
                <div className="absolute right-0 top-full mt-1 min-w-[170px] rounded-md border border-border-default bg-[var(--bg-inset-hover)] shadow-[var(--shadow-elevated)] py-1 z-20">
                  {availableTeams.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setPickerOpen(false);
                        onAddToTeam(t.id);
                      }}
                      className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary transition-colors cursor-pointer"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: t.color ?? DEFAULT_TEAM_COLOR }}
                      />
                      {t.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {memberTeams.length === 0 ? (
        <span className="text-[11px] text-text-secondary/50">Not in any team</span>
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
            "shrink-0 text-text-secondary/60 transition-transform",
            open && "rotate-90"
          )}
        />
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: team.color ?? DEFAULT_TEAM_COLOR }}
        />
        <span className="flex-1 min-w-0 truncate text-xs text-text-primary">
          {team.name}
        </span>
        <span className="shrink-0 text-[10px] font-mono text-text-secondary/60">
          {grantRows.length === 0
            ? "No scoping"
            : `${grantRows.length} scoped`}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2.5 bg-surface-raised-1 border-t border-border-subtle">
          {grantRows.length === 0 ? (
            <p className="pt-2 text-[11px] text-text-secondary/60">
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
                    <p className="text-xs text-text-primary truncate">{g.name}</p>
                    <p className="text-[10px] text-text-secondary/50">
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
              className="mt-2 text-[11px] text-red-400 hover:text-red-300 transition-colors cursor-pointer disabled:opacity-60"
            >
              Remove from this team
            </button>
          )}
        </div>
      )}
    </li>
  );
}
