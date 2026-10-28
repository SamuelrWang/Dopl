import type {
  ChannelTask,
  ChannelTaskSubtask,
  SubtaskState,
  TaskActor,
  TaskStatus,
} from "../types";

export const actorKey = (a: TaskActor): string =>
  a.kind === "agent" ? `agent:${a.agentId}` : `person:${a.userId}`;

export const isActiveTask = (t: ChannelTask) => t.status !== "resolved";

const ORDER: Record<TaskStatus, number> = { in_progress: 0, open: 1, resolved: 2 };

/** In progress first, then open, then resolved; each group most recently updated first. */
export const byTaskOrder = (a: ChannelTask, b: ChannelTask) =>
  ORDER[a.status] - ORDER[b.status] || b.updatedAt.localeCompare(a.updatedAt);

/** A subtask's check: done goes back to to-do, anything else is done. */
export const nextSubtaskState = (state: SubtaskState | undefined): SubtaskState =>
  state === "done" ? "todo" : "done";

/** The one derivation over a subtask list, shared with the server DTO (`dto-tasks.ts`): done over
 *  all, and the owners of in-progress subtasks in order, once each. */
export function subtaskFacts(
  subtasks: readonly ChannelTaskSubtask[]
): Pick<ChannelTask, "progress" | "active"> {
  const seen = new Set<string>();
  const active: TaskActor[] = [];
  for (const s of subtasks) {
    if (s.state !== "in_progress" || !s.owner || seen.has(actorKey(s.owner))) continue;
    seen.add(actorKey(s.owner));
    active.push(s.owner);
  }
  return {
    progress:
      subtasks.length === 0
        ? null
        : { done: subtasks.filter((s) => s.state === "done").length, total: subtasks.length },
    active,
  };
}
