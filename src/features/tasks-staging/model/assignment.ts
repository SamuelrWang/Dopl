/**
 * WHO DOES WHAT on a saved task, in ONE place so a ruling change is a one-file swap.
 *
 * Rules (Samuel, 2026-10-28):
 * - The task names a team, a set of identities, or nobody. None is required.
 * - A pinned step is done by that identity.
 * - An unpinned step is decided by the agents among themselves; when the task's team has a lead,
 *   the lead decides.
 *
 * Every line the UI prints about this comes from here; no component writes its own.
 */

import type { AgentIdentity } from "@/features/agent-identities/client/types";
import { SEED_IDENTITIES } from "@/features/identities-staging/data";
import { SEED_AGENT_TEAMS, type StagingAgentTeam } from "@/features/identities-staging/data/agent-teams";
import type { SavedStep, SavedTask, TaskAssignment } from "../data/saved-tasks";

export function identityOf(id: string | null): AgentIdentity | undefined {
  return id ? SEED_IDENTITIES.find((i) => i.id === id) : undefined;
}

export function teamOf(id: string): StagingAgentTeam | undefined {
  return SEED_AGENT_TEAMS.find((t) => t.id === id);
}

/** The team the task is assigned to, if it is. */
export function assignedTeam(task: Pick<SavedTask, "assignment">): StagingAgentTeam | undefined {
  return task.assignment.kind === "team" ? teamOf(task.assignment.teamId) : undefined;
}

/** "Release", "3 identities", "Nobody yet". */
export function assignmentLabel(assignment: TaskAssignment): string {
  if (assignment.kind === "team") return teamOf(assignment.teamId)?.name ?? "Deleted team";
  if (assignment.kind === "identities") {
    const n = assignment.identityIds.length;
    if (n === 1) return identityOf(assignment.identityIds[0])?.name ?? "Deleted identity";
    return `${n} identities`;
  }
  return "Nobody yet";
}

/** Who splits the unpinned steps, as one muted sentence under the assignment. */
export function splitLine(task: Pick<SavedTask, "assignment" | "steps">): string | null {
  if (task.steps.every((s) => s.pinnedIdentityId !== null)) return null;
  const team = assignedTeam(task);
  const lead = identityOf(team?.leadIdentityId ?? null);
  if (lead) return `${lead.name} decides who takes the unpinned steps.`;
  if (task.assignment.kind === "none") return "The agents you launch decide who takes each step.";
  return "The agents decide among themselves who takes each unpinned step.";
}

/** The chip an unpinned step wears. */
export const UNPINNED_CHIP = "Agents decide";

/** The identities a step could be pinned to: the task's people first, then everyone. */
export function pinOptions(task: Pick<SavedTask, "assignment">): AgentIdentity[] {
  const team = assignedTeam(task);
  const preferred =
    task.assignment.kind === "identities"
      ? task.assignment.identityIds
      : team
        ? team.slots.map((s) => s.identityId)
        : [];
  const first = SEED_IDENTITIES.filter((i) => preferred.includes(i.id));
  return [...first, ...SEED_IDENTITIES.filter((i) => !preferred.includes(i.id))];
}

/** Every identity a run of this task would start, each once (for face stacks). */
export function facesOf(task: Pick<SavedTask, "assignment" | "steps">): string[] {
  const team = assignedTeam(task);
  const base =
    task.assignment.kind === "identities"
      ? task.assignment.identityIds
      : team
        ? team.slots.map((s) => s.identityId)
        : [];
  const pinned = task.steps.map((s: SavedStep) => s.pinnedIdentityId).filter((x): x is string => !!x);
  return [...new Set([...base, ...pinned])];
}
