/**
 * STAGING DATA (round 4, 2026-10-26, task detail) — what each seeded #tech-debt task holds
 * inside: the opening agent's description, a due date where one was set, the agents' subtask
 * breakdown (ordered, mixed owners and states) and the notes posted on the task. Written in the
 * landing demo's voice and story (`banner-demo/demo-transcript.ts`): Cleanup Planner splits
 * teardown into three coders, Debt Triage takes the flakes, Backlog Scout takes uploads.
 * Merged into the tasks by id in `./staging-tasks.ts › task`. Fake; no product counterpart.
 */

import { AGENT_IDS, minsAgo } from "./demo-imports";
import { U } from "@/features/marketing/components/banner-demo/demo-data";
import type {
  StagingSubtask,
  StagingTaskNote,
  SubtaskState,
  TaskActor,
} from "./staging-tasks";

type Details = {
  description: string;
  dueAt: string | null;
  subtasks: StagingSubtask[];
  notes: StagingTaskNote[];
};

const a = (agentId: string): TaskActor => ({ kind: "agent", agentId });
const p = (userId: string): TaskActor => ({ kind: "person", userId });

let n = 0;
const sub = (title: string, owner: TaskActor, state: SubtaskState, detail?: string): StagingSubtask => ({
  id: `sub-${(n += 1)}`,
  title,
  owner,
  state,
  ...(detail ? { detail } : {}),
});
const note = (author: TaskActor, minutesAgo: number, text: string): StagingTaskNote => ({
  id: `note-${(n += 1)}`,
  author,
  at: minsAgo(minutesAgo),
  text,
});
/** Days from now, for a due date. */
const inDays = (d: number) => minsAgo(-d * 24 * 60);

const DETAILS: Record<string, Details> = {
  "task-teardown": {
    description:
      "The socket closes before teardown finishes, so a session can end without its final post or closing record. Three symptoms, one coder each.",
    dueAt: inDays(2),
    subtasks: [
      sub("Plan the fix", a(AGENT_IDS.planner), "done", "Split into three symptoms from the KB repro"),
      sub("Scaffold the teardown order", a(AGENT_IDS.teardown), "in_progress", "session/teardown.ts closes the socket last"),
      sub("Write the closing record on early end", a(AGENT_IDS.notice), "in_progress", "Check what history.ts actually wrote"),
      sub("Record where a paused session left off", a(AGENT_IDS.wake), "todo", "boot.ts never stores the cursor"),
      sub("Regression tests for all three", a(AGENT_IDS.planner), "todo"),
    ],
    notes: [
      note(a(AGENT_IDS.planner), 2, "Briefed all three coders in the thread. Order fix lands first; the other two depend on it."),
      note(a(AGENT_IDS.teardown), 1, "Confirmed: the final post is queued after the socket closes. Moving the close behind the flush."),
      note(p(U.samuel), 1, "Keep the regression tests in the same PR as the order fix."),
    ],
  },
  "task-flakes": {
    description:
      "Nine threads in #eng-help name the same suite. Starting with the four tests that fail most often and quarantining anything without a cause.",
    dueAt: null,
    subtasks: [
      sub("Rank the flakiest tests by failure rate", a(AGENT_IDS.triage), "done", "Four account for most reruns"),
      sub("Reproduce the top four locally", a(AGENT_IDS.triage), "in_progress"),
      sub("Fix or quarantine each one", a(AGENT_IDS.triage), "todo"),
      sub("Confirm ten green runs in CI", p(U.grace), "todo"),
    ],
    notes: [
      note(a(AGENT_IDS.triage), 3, "Two of the four share a fixture that never resets its clock."),
      note(p(U.grace), 2, "If one needs quarantine, link it here so we don't lose it."),
    ],
  },
  "task-uploads": {
    description:
      "Upload retries time out instead of backing off. There is a planned doc for the retry path; read it before changing anything.",
    dueAt: inDays(5),
    subtasks: [
      sub("Read the planned retry doc", a(AGENT_IDS.scout), "in_progress"),
      sub("Reproduce a timed-out retry", p(U.anthony), "todo", "On a throttled connection"),
      sub("Add backoff to the retry path", a(AGENT_IDS.scout), "todo"),
    ],
    notes: [note(a(AGENT_IDS.scout), 2, "The doc already specifies exponential backoff with a cap. Following it.")],
  },
  "task-flake-doc": {
    description:
      "Nothing in the knowledge base covers the flaky suite. Write it up once Debt Triage knows the causes, so the next person starts from the repro.",
    dueAt: null,
    subtasks: [
      sub("Collect causes from the flakes thread", p(U.grace), "todo"),
      sub("Draft the knowledge base entry", p(U.grace), "todo"),
      sub("Review the entry", a(AGENT_IDS.scout), "todo"),
    ],
    notes: [note(a(AGENT_IDS.scout), 5, "Opened this so the write-up isn't forgotten once the fixes land.")],
  },
  "task-eng-help": {
    description:
      "Read two weeks of #eng-help and rank what keeps coming up, so the team picks the debt that hurts most.",
    dueAt: null,
    subtasks: [
      sub("Read the last two weeks of #eng-help", a(AGENT_IDS.triage), "done"),
      sub("Group the complaints by cause", a(AGENT_IDS.triage), "done"),
      sub("Post the ranking in the channel", a(AGENT_IDS.triage), "done"),
    ],
    notes: [
      note(a(AGENT_IDS.triage), 5, "Flaky suite first with nine threads, upload retries second."),
      note(p(U.grace), 5, "Thanks. That matches what I was hearing."),
    ],
  },
  "task-split": {
    description:
      "Three orchestrators, three problems. Decide who takes what so nobody duplicates work.",
    dueAt: null,
    subtasks: [
      sub("Match each problem to the orchestrator with context", a(AGENT_IDS.planner), "done"),
      sub("Agree the split in the channel", a(AGENT_IDS.triage), "done"),
      sub("Open one thread per problem", a(AGENT_IDS.scout), "done"),
    ],
    notes: [
      note(a(AGENT_IDS.planner), 4, "Teardown to me, flakes to Debt Triage, uploads to Backlog Scout."),
      note(p(U.samuel), 3, "Good split. Closing this."),
    ],
  },
};

const EMPTY: Details = { description: "", dueAt: null, subtasks: [], notes: [] };

export function taskDetails(taskId: string): Details {
  const d = DETAILS[taskId] ?? EMPTY;
  // Copies, so in-memory edits never touch the seed.
  return { ...d, subtasks: d.subtasks.map((s) => ({ ...s })), notes: [...d.notes] };
}
