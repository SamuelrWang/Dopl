"use client";

import { ListChecks, Play } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import { FactChip } from "@/features/agent-identities/components/identity-section";
import type { StagingAgentTeam } from "../data/agent-teams";
import { TeamStack } from "./team-faces";
import { slotSummary } from "./team-model";

export type TeamLaunchState = "idle" | "starting" | "running";

/** One team as a card: its faces and name, who is in it, its task templates, and Launch. */
export function TeamCard({
  team,
  marker,
  launch,
  onOpen,
  onLaunch,
}: {
  team: StagingAgentTeam;
  /** `by <member>` for a team the viewer did not write. */
  marker: string | null;
  /** `null` = no channel selected, so nothing to launch into. */
  launch: TeamLaunchState | null;
  onOpen: () => void;
  onLaunch: () => void;
}) {
  return (
    <div className="white-card card-lift flex min-h-[104px] flex-col gap-2.5 p-3 text-left">
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 cursor-pointer flex-col items-start gap-2.5 text-left"
      >
        <span className="flex w-full min-w-0 items-center gap-2.5">
          <TeamStack team={team} size={30} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={cn("min-w-0 truncate", IDENTITY_NAME_TEXT)}>{team.name}</span>
            {marker && <span className="min-w-0 truncate text-label text-text-muted">{marker}</span>}
          </span>
        </span>
        <span className="line-clamp-2 text-small leading-relaxed text-text-secondary">
          {slotSummary(team)}
        </span>
        <span className="flex w-full min-w-0 flex-wrap items-center gap-1.5">
          {team.templates.map((t) => (
            <FactChip key={t.id} mark={<ListChecks size={12} strokeWidth={2} aria-hidden="true" />}>
              {t.title}
            </FactChip>
          ))}
        </span>
      </button>
      {launch && (
        <div className="mt-auto flex w-full items-center justify-between gap-2 border-t border-border-default pt-2.5">
          {launch === "running" ? (
            <span className="flex items-center gap-1.5 text-label">
              <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
              <span className="font-medium text-text-primary">Running</span>
            </span>
          ) : (
            <span />
          )}
          <OpenScaleButton
            onClick={onLaunch}
            disabled={launch === "starting"}
            className="gap-1.5 disabled:opacity-60"
          >
            <Play size={OPEN_SCALE_ICON} strokeWidth={2} aria-hidden="true" />
            {launch === "starting" ? "Starting…" : "Launch"}
          </OpenScaleButton>
        </div>
      )}
    </div>
  );
}
