"use client";

/**
 * STAGING MOCKUP (PROPOSAL §2, "Launch entry points" 2 and the Agents-tab grouping): a "Launch
 * team" picker and each launched team as one group, at the top of the PRODUCT Agents tab. The
 * product tab has no slot for it, so this portals into the tab's scroll body while the Agents tab
 * is the one on screen. Local state only.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { toast } from "@/shared/ui/toast";
import { TAB_ACTION_LIGHT } from "@/features/channels/components/bits";
import {
  SEED_AGENT_TEAMS,
  SEED_TEAM_RUN,
  type StagingAgentTeam,
  type StagingTeamRun,
} from "@/features/identities-staging/data/agent-teams";
import { TeamStack } from "@/features/identities-staging/teams/team-faces";
import { slotSummary, startRun } from "@/features/identities-staging/teams/team-model";
import { TeamRunGroup } from "@/features/identities-staging/teams/team-run-group";
import { VIEWER } from "../data/demo-imports";

const INFO = 'aside[aria-label="Channel info"]';
const HOST = "data-staging-agent-teams";

/** The Agents tab's scroll body, or `null` while another tab is on screen. */
function agentsBody(): HTMLElement | null {
  const info = document.querySelector(INFO);
  const selected = info?.querySelector('[role="tab"][aria-selected="true"]');
  if (!selected?.textContent?.trim().startsWith("Agents")) return null;
  return info?.querySelector<HTMLElement>("div.overflow-y-auto") ?? null;
}

function useAgentsTabHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const sync = () => {
      const body = agentsBody();
      if (!body) return setHost(null);
      let el = body.querySelector<HTMLElement>(`[${HOST}]`);
      if (!el) {
        el = document.createElement("div");
        el.setAttribute(HOST, "");
        body.prepend(el);
      }
      setHost((prev) => (prev === el ? prev : el));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
    return () => observer.disconnect();
  }, []);
  return host;
}

export function StagingAgentTeamsSlot({ channelName }: { channelName: string }) {
  const host = useAgentsTabHost();
  const [runs, setRuns] = useState<StagingTeamRun[]>(
    channelName === SEED_TEAM_RUN.channelName ? [SEED_TEAM_RUN] : []
  );
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  const launch = (team: StagingAgentTeam) => {
    const template = team.templates[0];
    if (!template) return;
    setOpen(false);
    setStarting(team.id);
    window.setTimeout(() => {
      setStarting(null);
      setRuns((all) => [startRun(team, template.id, channelName), ...all.filter((r) => r.teamId !== team.id)]);
      toast({ title: `"${team.name}" launched: ${template.title}`, variant: "invert" });
    }, 900);
  };

  if (!host) return null;
  return createPortal(
    <div className="mb-4 flex flex-col gap-2">
      <div className="relative flex justify-end">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={starting !== null}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(TAB_ACTION_LIGHT, "cursor-pointer disabled:opacity-60")}
        >
          <Users size={13} aria-hidden="true" />
          {starting ? "Starting team…" : "Launch team"}
          <ChevronDown size={13} aria-hidden="true" className="text-text-muted" />
        </button>
        {open && (
          <ul
            role="menu"
            aria-label="Agent teams"
            className="white-card absolute top-full right-0 z-20 mt-1.5 flex w-72 flex-col p-1"
          >
            {SEED_AGENT_TEAMS.map((team) => (
              <li key={team.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => launch(team)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-menu-item-hover-bg"
                >
                  <TeamStack team={team} size="s" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-small font-medium text-text-primary">{team.name}</span>
                    <span className="truncate text-caption text-text-muted">{slotSummary(team)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {runs.map((run) => {
        const team = SEED_AGENT_TEAMS.find((t) => t.id === run.teamId);
        return (
          team && (
            <TeamRunGroup key={run.teamId} team={team} run={run} ownerPhoto={VIEWER.avatarUrl ?? null} />
          )
        );
      })}
    </div>,
    host
  );
}
