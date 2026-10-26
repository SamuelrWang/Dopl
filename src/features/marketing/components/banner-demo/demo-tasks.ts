/**
 * The channel's tasks at each beat, in the contract's shape (`@dopl/contracts › tasks.ts`). Debt
 * Triage opens one from its flakes thread, breaks it into subtasks, works them off, posts a note
 * and resolves it; two older tasks sit beside it. The builders are shared with the /channels
 * staging seeds.
 */

import { subtaskFacts } from "@/features/channels/lib/task-model";
import type {
  ChannelTaskDetail,
  ChannelTaskNote,
  ChannelTaskSubtask,
  SubtaskState,
  TaskActor,
  TaskLink,
  TaskStatus,
} from "@/features/channels/types";
import { reached, type StepId } from "./demo-steps";
import { AGENT_IDS, CHANNEL_ID, THREADS, THREAD_IDS, U, WORKSPACE_ID, minsAgo } from "./demo-data";
import { agentOwner } from "./demo-identities";

/** An agent acts under its operator's account. */
export const agentActor = (agentId: string): TaskActor => ({
  kind: "agent",
  agentId,
  userId: agentOwner(agentId) ?? U.samuel,
});
export const personActor = (userId: string): TaskActor => ({ kind: "person", userId });

type TaskFields = Pick<
  ChannelTaskDetail,
  "id" | "title" | "description" | "dueAt" | "subtasks" | "notes" | "createdBy" | "assignees"
> & {
  status: TaskStatus;
  link: TaskLink | null;
  createdAt: string;
  updatedAt?: string;
  resolved?: { by: TaskActor; at: string };
};

/** A task in this channel; progress and the active owners derive from its subtasks. */
export function channelTask({ resolved, updatedAt, ...t }: TaskFields): ChannelTaskDetail {
  return {
    ...t,
    channelId: CHANNEL_ID,
    workspaceId: WORKSPACE_ID,
    ...subtaskFacts(t.subtasks),
    notesTruncated: false,
    updatedAt: resolved?.at ?? updatedAt ?? t.createdAt,
    resolvedAt: resolved?.at ?? null,
    resolvedBy: resolved?.by ?? null,
  };
}

export const threadLink = (threadId: string): TaskLink | null => {
  const t = THREADS.find((x) => x.id === threadId);
  return t ? { kind: "thread", threadId, title: t.title } : null;
};

const DAY = 24 * 60;
const triage = agentActor(AGENT_IDS.triage);

const subtask = (
  id: string,
  title: string,
  owner: TaskActor,
  state: SubtaskState,
  position: number,
  at: string
): ChannelTaskSubtask => ({
  id,
  title,
  detail: null,
  owner,
  state,
  position,
  createdAt: at,
  updatedAt: at,
});

const OLDER_TASKS: readonly ChannelTaskDetail[] = [
  channelTask({
    id: "demo-task-export",
    title: "Remove the retired v1 export endpoint",
    description:
      "Nothing has called the v1 export endpoint since the v2 rollout. Remove the route along with its tests and docs.",
    dueAt: null,
    subtasks: [
      subtask("demo-sub-export-1", "Confirm no client still calls it", personActor(U.anthony), "done", 1, minsAgo(DAY)),
      subtask("demo-sub-export-2", "Delete the route and its tests", personActor(U.anthony), "todo", 2, minsAgo(DAY)),
    ],
    notes: [],
    createdBy: personActor(U.anthony),
    assignees: [personActor(U.anthony)],
    status: "open",
    link: null,
    createdAt: minsAgo(2 * DAY),
    updatedAt: minsAgo(DAY),
  }),
  channelTask({
    id: "demo-task-flags",
    title: "Remove the six feature flags already on for every account",
    description: "All six reached every account weeks ago and still branch the settings code.",
    dueAt: null,
    subtasks: [
      subtask("demo-sub-flags-1", "List the flags at full rollout", personActor(U.grace), "done", 1, minsAgo(2 * DAY)),
      subtask("demo-sub-flags-2", "Delete the flags and their dead branches", personActor(U.grace), "done", 2, minsAgo(DAY)),
    ],
    notes: [],
    createdBy: personActor(U.grace),
    assignees: [personActor(U.grace)],
    status: "resolved",
    link: null,
    createdAt: minsAgo(3 * DAY),
    resolved: { by: personActor(U.grace), at: minsAgo(DAY) },
  }),
];

export const FLAKES_TASK_ID = "demo-task-flakes";
export const FLAKES_TASK_TITLE = "Fix the four tests that fail most often";

/** Each subtask's beats: added with the breakdown, started, then ticked off. */
const FLAKE_SUBTASKS: ReadonlyArray<{ title: string; starts: StepId; done: StepId }> = [
  { title: "Reproduce the four failures locally", starts: "brief-1", done: "coder-ack" },
  { title: "Replace fixed sleeps with explicit waits", starts: "coder-ack", done: "concurrent-2" },
  { title: "Pin the time zone in the date tests", starts: "concurrent-2", done: "task-tick-1" },
  { title: "Confirm twenty consecutive green runs", starts: "task-tick-1", done: "task-tick-2" },
];
const BREAKDOWN: StepId = FLAKE_SUBTASKS[0].starts;

const FLAKE_NOTES: ReadonlyArray<{ step: StepId; body: string; minutesAgo: number }> = [
  {
    step: "coder-ack",
    body: "Reproduced all four. Two wait on fixed sleeps that lose the race on a slow runner, and two read the machine's local time zone.",
    minutesAgo: 1,
  },
  {
    step: "task-note",
    body: "Twenty consecutive green runs on CI. Merging straight in since the change only touches tests.",
    minutesAgo: 0,
  },
];

const subtaskState = (step: number, s: (typeof FLAKE_SUBTASKS)[number]): SubtaskState =>
  reached(step, s.done) ? "done" : reached(step, s.starts) ? "in_progress" : "todo";

function flakesTaskAt(step: number): ChannelTaskDetail {
  const subtasks = reached(step, BREAKDOWN)
    ? FLAKE_SUBTASKS.map((s, i) =>
        subtask(`demo-sub-flakes-${i + 1}`, s.title, triage, subtaskState(step, s), i + 1, minsAgo(2))
      )
    : [];
  const notes: ChannelTaskNote[] = FLAKE_NOTES.filter((n) => reached(step, n.step)).map((n, i) => ({
    id: `demo-note-flakes-${i + 1}`,
    author: triage,
    body: n.body,
    createdAt: minsAgo(n.minutesAgo),
  }));
  const resolved = reached(step, "task-resolved");
  return channelTask({
    id: FLAKES_TASK_ID,
    title: FLAKES_TASK_TITLE,
    description:
      "Four tests cause most of the reruns reported in #eng-help. Fix the cause of each one instead of retrying them.",
    dueAt: null,
    subtasks,
    notes,
    createdBy: triage,
    assignees: [triage],
    status: resolved ? "resolved" : reached(step, BREAKDOWN) ? "in_progress" : "open",
    link: threadLink(THREAD_IDS.flakes),
    createdAt: minsAgo(3),
    updatedAt: minsAgo(reached(step, BREAKDOWN) ? 1 : 3),
    resolved: resolved ? { by: triage, at: minsAgo(0) } : undefined,
  });
}

/** Debt Triage opens its task with the flakes thread. */
export function tasksAt(step: number): ChannelTaskDetail[] {
  return reached(step, "thread-1") ? [...OLDER_TASKS, flakesTaskAt(step)] : [...OLDER_TASKS];
}

/** The task whose detail the Tasks tab shows: from the pop-up row's press to the crumb's. */
export const openTaskAt = (step: number): string | null =>
  reached(step, "click-task") && !reached(step, "click-task-crumb") ? FLAKES_TASK_ID : null;

/** The info column's ask to show Tasks (`ChannelsInfoPanel › tasksTabSignal`), rising once. */
export const tasksTabSignalAt = (step: number): number => (reached(step, "click-task") ? 1 : 0);
