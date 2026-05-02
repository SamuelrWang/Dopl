"use client";

import { useState } from "react";
import { MoreHorizontal, Plus, Sparkles, Users } from "lucide-react";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { MEMBERS, TEAMS } from "../data";
import { TabButton } from "./member-bits";
import { MembersTable } from "./members-table";
import { TeamsPane } from "./teams-pane";

type Tab = "members" | "teams";

/**
 * Members + Teams page shell.
 *
 * Two top-level tabs:
 *   Members → table of every member, click a row to expand the per-
 *             member access matrix (KB and skill grants, individually
 *             scoped to none/read/edit).
 *   Teams   → split pane: team list on the left, team detail on the
 *             right with the team's roster + the same access matrix.
 *             Members of a team inherit the team's grants by default.
 *
 * Static visual pass — every interaction is local useState, no API
 * calls. When this graduates, members come from `workspace_members`
 * and teams from a new `workspace_teams` table.
 */
export function MembersView() {
  const [tab, setTab] = useState<Tab>("members");

  return (
    <>
      <PageTopBar
        title="Members"
        trailing={
          <>
            <button
              type="button"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/[0.08] hover:bg-white/[0.04] transition-colors text-xs text-text-primary cursor-pointer"
            >
              <Plus size={12} />
              {tab === "members" ? "Add member" : "Add team"}
            </button>
            <button
              type="button"
              aria-label="More"
              className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/[0.04] transition-colors cursor-pointer"
            >
              <MoreHorizontal size={13} className="text-text-secondary" />
            </button>
          </>
        }
      />

      <div className="fixed top-[52px] right-0 bottom-0 left-0 md:left-64 z-[3] p-3 pointer-events-auto">
        <div
          className="h-full rounded-2xl border border-white/[0.1] overflow-hidden flex flex-col"
          style={{ backgroundColor: "oklch(0.13 0 0)" }}
        >
          <div className="flex items-center gap-1 border-b border-white/[0.06] px-3">
            <TabButton active={tab === "members"} onClick={() => setTab("members")}>
              <Users size={13} />
              Members
              <span className="ml-1 text-[11px] font-mono text-text-secondary/60">
                {MEMBERS.length}
              </span>
            </TabButton>
            <TabButton active={tab === "teams"} onClick={() => setTab("teams")}>
              <Sparkles size={13} />
              Teams
              <span className="ml-1 text-[11px] font-mono text-text-secondary/60">
                {TEAMS.length}
              </span>
            </TabButton>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {tab === "members" ? <MembersTable /> : <TeamsPane />}
          </div>
        </div>
      </div>
    </>
  );
}
