"use client";

import { useState } from "react";
import { FormDialog, FormSection, UnderlineField } from "@/shared/ui/form-dialog";
import type { StagingAgentTeam } from "../data/agent-teams";
import { TeamStack } from "./team-faces";
import { seatTotal, slotSummary } from "./team-model";

/**
 * LAUNCH WITH A GOAL: a team holds no saved tasks, so a launch asks for one free goal. Every seat
 * gets it; the run shows it as its title. Staged: Launch hands the goal back, nothing starts.
 */
export function TeamLaunchDialog({
  team,
  channelName,
  onLaunch,
  onClose,
}: {
  team: StagingAgentTeam;
  channelName: string;
  onLaunch: (goal: string) => void;
  onClose: () => void;
}) {
  const [goal, setGoal] = useState("");
  const seats = seatTotal(team);
  const ready = goal.trim() !== "";

  return (
    <FormDialog
      open
      onDiscard={onClose}
      title={`Launch ${team.name}`}
      titleCase={false}
      primary={{
        label: "Launch",
        disabled: !ready,
        hint: ready ? undefined : "Write the goal the team works toward.",
        onClick: () => onLaunch(goal.trim()),
      }}
    >
      <FormSection label="Team" caption={`${seats} ${seats === 1 ? "agent" : "agents"} into #${channelName}`}>
        <span className="flex min-w-0 items-center gap-2.5">
          <TeamStack team={team} size="m" />
          <span className="min-w-0 truncate text-caption text-text-secondary">{slotSummary(team)}</span>
        </span>
      </FormSection>
      <UnderlineField
        id="team-goal"
        label="Goal"
        ariaLabel="Goal for the team"
        placeholder="Clean up the billing module before Friday's release."
        value={goal}
        onChange={setGoal}
        multiline
        autoFocus
      />
    </FormDialog>
  );
}
