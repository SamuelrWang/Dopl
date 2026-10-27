/** Read helpers over the staged agent teams: who wears each slot, and the lines a card prints. */

import type { AgentIdentity } from "@/features/agent-identities/client/types";
import { SEED_IDENTITIES } from "../data";
import type { StagingAgentTeam, StagingTeamRun, StagingTeamSeat } from "../data/agent-teams";

export function identityOf(id: string): AgentIdentity | undefined {
  return SEED_IDENTITIES.find((i) => i.id === id);
}

/** "Coder ×1 · Comment writer ×1 · Code tester ×1". */
export function slotSummary(team: StagingAgentTeam): string {
  return team.slots.map((s) => `${s.label} ×${s.seats}`).join(" · ");
}

export function seatTotal(team: StagingAgentTeam): number {
  return team.slots.reduce((n, s) => n + s.seats, 0);
}

export function runProgress(run: StagingTeamRun): { done: number; total: number } {
  return { done: run.seats.filter((s) => s.state === "done").length, total: run.seats.length };
}

export const SEAT_STATE: Record<
  StagingTeamSeat["state"],
  { label: string; tone: "live" | "neutral" | "done" }
> = {
  working: { label: "Working", tone: "live" },
  idle: { label: "Idle", tone: "neutral" },
  done: { label: "Done", tone: "done" },
};

const RUN_COLORS = ["agent-02", "agent-05", "agent-08", "agent-11", "agent-13"] as const;

/** A fresh run of `team`'s template: one working seat per slot seat. */
export function startRun(team: StagingAgentTeam, templateId: string, channelName: string): StagingTeamRun {
  const seats = team.slots.flatMap((slot) =>
    Array.from({ length: slot.seats }, (_, i) => ({
      slotId: slot.id,
      agentName: slot.seats > 1 ? `${slot.label} ${i + 1}` : slot.label,
    }))
  );
  return {
    teamId: team.id,
    templateId,
    channelName,
    startedAgo: 0,
    seats: seats.map(
      (s, i): StagingTeamSeat => ({ ...s, state: "working", color: RUN_COLORS[i % RUN_COLORS.length] })
    ),
  };
}
