"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MEMBERS, TEAMS } from "../data";
import { Avatar } from "./member-bits";
import { AccessMatrix } from "./access-matrix";

/**
 * Teams tab — split pane: team list rail on the left, selected team's
 * detail (members + access matrix) on the right.
 */
export function TeamsPane() {
  const [activeTeamId, setActiveTeamId] = useState<string>(TEAMS[0]?.id ?? "");
  const team = TEAMS.find((t) => t.id === activeTeamId) ?? TEAMS[0];

  return (
    <div className="h-full flex">
      <aside className="w-72 shrink-0 border-r border-white/[0.06] flex flex-col">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
            Teams
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto py-1">
          {TEAMS.map((t) => {
            const active = t.id === activeTeamId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTeamId(t.id)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-4 py-2 text-left transition-colors cursor-pointer",
                  active
                    ? "bg-white/[0.04]"
                    : "hover:bg-white/[0.02]"
                )}
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm truncate",
                      active ? "text-text-primary" : "text-text-secondary"
                    )}
                  >
                    {t.name}
                  </p>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/50 mt-0.5">
                    {t.memberIds.length} members
                  </p>
                </div>
                <div className="flex -space-x-1.5 shrink-0">
                  {t.memberIds.slice(0, 3).map((id) => {
                    const m = MEMBERS.find((mm) => mm.id === id);
                    if (!m) return null;
                    return (
                      <Avatar
                        key={id}
                        member={m}
                        size="xs"
                        className="ring-2 ring-[oklch(0.13_0_0)]"
                      />
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {team && (
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="px-6 py-5 border-b border-white/[0.06]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-text-primary">
                  {team.name}
                </h2>
                <p className="mt-0.5 text-xs text-text-secondary/80 leading-relaxed max-w-xl">
                  {team.description}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 text-[11px] text-text-secondary hover:text-text-primary px-2 py-1 cursor-pointer"
              >
                Edit team
              </button>
            </div>

            <div className="mt-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60 mb-2">
                Members ({team.memberIds.length})
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {team.memberIds.map((id) => {
                  const m = MEMBERS.find((mm) => mm.id === id);
                  if (!m) return null;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-white/[0.03] border border-white/[0.06]"
                    >
                      <Avatar member={m} size="xs" />
                      <span className="text-[12px] text-text-primary">
                        {m.name}
                      </span>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="flex items-center gap-1 px-2 py-1 rounded-full border border-dashed border-white/[0.1] text-[11px] text-text-secondary hover:border-white/[0.2] hover:text-text-primary cursor-pointer transition-colors"
                >
                  <Plus size={11} />
                  Add
                </button>
              </div>
            </div>
          </div>

          <div className="px-6 py-5">
            <AccessMatrix
              knowledgeAccess={team.knowledgeAccess}
              skillAccess={team.skillAccess}
              inheritFrom={null}
            />
          </div>
        </div>
      )}
    </div>
  );
}
