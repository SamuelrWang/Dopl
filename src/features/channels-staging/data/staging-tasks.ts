/**
 * STAGING DATA (new 2026-10-26, channel tasks) — the fake TASK MODEL behind both task variants
 * (`home/tasks-info-panel.tsx` = the Tasks tab, `home/tasks-popover.tsx` = the bottom-right pill).
 * No product counterpart yet: there is no tasks table, route or MCP tool. In the product an
 * AGENT opens a task when it recognises one in the conversation, assigns it (itself, other
 * agents, people), and the agent and the people close it together when it is resolved.
 *
 * Seeded for #tech-debt only, read off the demo's own messages and threads (bodies matched by
 * prefix, the way `tech-debt-fixture.ts` finds its split post), so every link opens something
 * real. Other channels start empty, which is the empty state.
 */

import { AGENT_IDS, DEMO_CHANNEL, minsAgo } from "./demo-imports";
import { THREAD_IDS, U } from "@/features/marketing/components/banner-demo/demo-data";
import type { ChannelFixture } from "./staging-fixture-types";
import { taskDetails } from "./staging-task-details";

export type TaskActor =
  | { kind: "agent"; agentId: string }
  | { kind: "person"; userId: string };

/** open → in progress → resolved. "Closed" in Samuel's words is the resolved state. */
export type TaskStatus = "open" | "in_progress" | "resolved";

/** Where the task came from: its thread, or the channel message it was recognised in. */
export type TaskLink =
  | { kind: "thread"; threadId: string; label: string }
  | { kind: "message"; messageId: string; seq: number };

/** Round 4: the agents' own breakdown of a task, in order. */
export type SubtaskState = "todo" | "in_progress" | "done";
export type StagingSubtask = {
  id: string;
  title: string;
  /** One line, optional. */
  detail?: string;
  owner: TaskActor;
  state: SubtaskState;
};

/** Round 4: a short note on the task (agents and people). Notes, not chat. */
export type StagingTaskNote = { id: string; author: TaskActor; at: string; text: string };

export type StagingTask = {
  id: string;
  title: string;
  /** Written by the agent that opened the task. */
  description: string;
  dueAt: string | null;
  subtasks: StagingSubtask[];
  notes: StagingTaskNote[];
  createdBy: TaskActor;
  /** One agent, several agents, and/or people. */
  assignees: TaskActor[];
  status: TaskStatus;
  link: TaskLink | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: TaskActor | null;
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

export const isActive = (t: StagingTask) => t.status !== "resolved";

export const SUBTASK_STATE_LABEL: Record<SubtaskState, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

/** "2/4": done subtasks over all of them; `null` when the task has none. */
export function subtaskProgress(t: StagingTask): { done: number; total: number } | null {
  if (t.subtasks.length === 0) return null;
  return { done: t.subtasks.filter((s) => s.state === "done").length, total: t.subtasks.length };
}

/** Who is on it now: owners of in-progress subtasks, in order, once each. */
export function activeActors(t: StagingTask): TaskActor[] {
  const seen = new Set<string>();
  const out: TaskActor[] = [];
  for (const s of t.subtasks) {
    if (s.state !== "in_progress") continue;
    const key = s.owner.kind === "agent" ? s.owner.agentId : s.owner.userId;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.owner);
  }
  return out;
}

const agent = (agentId: string): TaskActor => ({ kind: "agent", agentId });
const person = (userId: string): TaskActor => ({ kind: "person", userId });

function threadLink(f: ChannelFixture, threadId: string): TaskLink | null {
  const t = f.threads.find((x) => x.id === threadId);
  return t ? { kind: "thread", threadId, label: t.title } : null;
}

function messageLink(f: ChannelFixture, bodyPrefix: string): TaskLink | null {
  const m = f.messages.find((x) => x.body.startsWith(bodyPrefix));
  return m ? { kind: "message", messageId: m.id, seq: m.seq } : null;
}

function task(
  id: string,
  title: string,
  createdBy: TaskActor,
  assignees: TaskActor[],
  status: TaskStatus,
  link: TaskLink | null,
  minutesAgo: number,
  resolved?: { by: TaskActor; minutesAgo: number }
): StagingTask {
  return {
    id,
    title,
    // Round 4: description, due date, subtasks and notes (`./staging-task-details.ts`).
    ...taskDetails(id),
    createdBy,
    assignees,
    status,
    link,
    createdAt: minsAgo(minutesAgo),
    updatedAt: minsAgo(resolved?.minutesAgo ?? minutesAgo),
    resolvedAt: resolved ? minsAgo(resolved.minutesAgo) : null,
    resolvedBy: resolved?.by ?? null,
  };
}

/** The channel's seeded tasks; `[]` for every channel but the demo's. */
export function seedTasks(f: ChannelFixture): StagingTask[] {
  if (f.channel.id !== DEMO_CHANNEL.id) return [];
  return [
    task(
      "task-teardown",
      "Fix session teardown leaks",
      agent(AGENT_IDS.planner),
      [agent(AGENT_IDS.teardown), agent(AGENT_IDS.notice), agent(AGENT_IDS.wake)],
      "in_progress",
      threadLink(f, THREAD_IDS.teardown),
      3
    ),
    task(
      "task-flakes",
      "Stabilise the four flakiest tests",
      agent(AGENT_IDS.triage),
      [agent(AGENT_IDS.triage)],
      "in_progress",
      threadLink(f, THREAD_IDS.flakes),
      3
    ),
    task(
      "task-uploads",
      "Fix upload retries timing out",
      agent(AGENT_IDS.scout),
      [agent(AGENT_IDS.scout), person(U.anthony)],
      "open",
      threadLink(f, THREAD_IDS.uploads),
      2
    ),
    task(
      "task-flake-doc",
      "Write up the flaky suite in the knowledge base",
      agent(AGENT_IDS.scout),
      [person(U.grace)],
      "open",
      messageLink(f, "Checked the knowledge base."),
      5
    ),
    task(
      "task-eng-help",
      "Rank the complaints in #eng-help",
      person(U.grace),
      [agent(AGENT_IDS.triage)],
      "resolved",
      messageLink(f, "Read the last two weeks"),
      6,
      { by: agent(AGENT_IDS.triage), minutesAgo: 5 }
    ),
    task(
      "task-split",
      "Split the cleanup between the orchestrators",
      person(U.samuel),
      [agent(AGENT_IDS.planner), agent(AGENT_IDS.triage), agent(AGENT_IDS.scout)],
      "resolved",
      messageLink(f, "@debt-triage you have the most context"),
      6,
      { by: person(U.samuel), minutesAgo: 3 }
    ),
  ];
}
