/**
 * UI-STAGING FAKE DATA: the Tasks page's agenda (Samuel, 2026-10-28: the time spine). Today is
 * Wednesday Oct 28 at 12:15 in the mockup; nothing reads the clock. An entry is a one-off channel
 * task or one run of a saved task, placed on its hour; one-offs with no time sit under Anytime.
 */

import { STAGING_TASK_CHANNELS } from "./channels";
import type { TaskAssignment } from "./saved-tasks";

export type AgendaDay = "today" | "tomorrow" | "week" | "anytime";

export const AGENDA_DAYS: ReadonlyArray<{ key: AgendaDay; label: string; date: string | null }> = [
  { key: "today", label: "Today", date: "Wednesday, Oct 28" },
  { key: "tomorrow", label: "Tomorrow", date: "Thursday, Oct 29" },
  { key: "week", label: "This week", date: "Friday to Sunday" },
  { key: "anytime", label: "Anytime", date: "No time set" },
];

/** The mockup's "now", drawn as a rule across Today. */
export const NOW_LABEL = "12:15";
/** Minutes since midnight of {@link NOW_LABEL}, so the rule lands between the right rows. */
export const NOW_MINUTES = 12 * 60 + 15;

/**
 * `upcoming` = scheduled, not started. `missed` = its hour passed while the desktop app was
 * closed. `needs_you` = an agent is waiting on a person. `open` = a one-off nobody has started.
 */
export type AgendaState = "upcoming" | "running" | "done" | "missed" | "needs_you" | "open";

export interface AgendaEntry {
  id: string;
  day: AgendaDay;
  /** "9:00"; `null` under Anytime. */
  time: string | null;
  /** A day name inside "This week". */
  weekday?: string;
  title: string;
  channelId: string;
  /** Set = a run of this saved task. Absent = a one-off channel task. */
  savedTaskId?: string;
  state: AgendaState;
  progress: { done: number; total: number } | null;
  assignment: TaskAssignment;
  /** One muted fact for the meta line (who launched it, what it waits on). */
  note?: string;
}

const [TECH_DEBT, RELEASES, RESEARCH] = STAGING_TASK_CHANNELS.map((c) => c.id);

export const SEED_AGENDA: AgendaEntry[] = [
  // Today
  {
    id: "ag-standup-today",
    day: "today",
    time: "8:30",
    title: "Standup notes",
    channelId: TECH_DEBT,
    savedTaskId: "st-standup",
    state: "missed",
    progress: { done: 0, total: 2 },
    assignment: { kind: "identities", identityIds: ["id-chief"] },
  },
  {
    id: "ag-flaky",
    day: "today",
    time: "10:00",
    title: "Fix the flaky checkout test",
    channelId: TECH_DEBT,
    state: "done",
    progress: { done: 3, total: 3 },
    assignment: { kind: "identities", identityIds: ["id-flake"] },
    note: "Resolved by Flake Hunter",
  },
  {
    id: "ag-release-today",
    day: "today",
    time: "11:40",
    title: "Cut a release",
    channelId: RELEASES,
    savedTaskId: "st-release",
    state: "running",
    progress: { done: 1, total: 3 },
    assignment: { kind: "team", teamId: "team-release" },
    note: "Launched by Grace",
  },
  {
    id: "ag-pricing",
    day: "today",
    time: "14:00",
    title: "Review the pricing page copy",
    channelId: RESEARCH,
    state: "needs_you",
    progress: { done: 1, total: 2 },
    assignment: { kind: "identities", identityIds: ["id-writer"] },
    note: "Writer is waiting on your answer",
  },
  {
    id: "ag-migrations-today",
    day: "today",
    time: "17:00",
    title: "Migration review",
    channelId: TECH_DEBT,
    savedTaskId: "st-migrations",
    state: "upcoming",
    progress: { done: 0, total: 2 },
    assignment: { kind: "identities", identityIds: ["id-sql", "id-flake"] },
  },
  // Tomorrow
  {
    id: "ag-standup-tomorrow",
    day: "tomorrow",
    time: "8:30",
    title: "Standup notes",
    channelId: TECH_DEBT,
    savedTaskId: "st-standup",
    state: "upcoming",
    progress: { done: 0, total: 2 },
    assignment: { kind: "identities", identityIds: ["id-chief"] },
  },
  {
    id: "ag-release-thu",
    day: "tomorrow",
    time: "15:00",
    title: "Cut a release",
    channelId: RELEASES,
    savedTaskId: "st-release",
    state: "upcoming",
    progress: { done: 0, total: 3 },
    assignment: { kind: "team", teamId: "team-release" },
  },
  {
    id: "ag-migrations-tomorrow",
    day: "tomorrow",
    time: "17:00",
    title: "Migration review",
    channelId: TECH_DEBT,
    savedTaskId: "st-migrations",
    state: "upcoming",
    progress: { done: 0, total: 2 },
    assignment: { kind: "identities", identityIds: ["id-sql", "id-flake"] },
  },
  // This week
  {
    id: "ag-cleanup-fri",
    day: "week",
    weekday: "Fri",
    time: "14:00",
    title: "Dependency cleanup",
    channelId: TECH_DEBT,
    savedTaskId: "st-cleanup",
    state: "upcoming",
    progress: { done: 0, total: 3 },
    assignment: { kind: "none" },
  },
  // Anytime
  {
    id: "ag-env-vars",
    day: "anytime",
    time: null,
    title: "Rename the billing env vars",
    channelId: TECH_DEBT,
    state: "running",
    progress: { done: 1, total: 3 },
    assignment: { kind: "identities", identityIds: ["id-coder"] },
  },
  {
    id: "ag-roadmap",
    day: "anytime",
    time: null,
    title: "Draft the Q4 roadmap",
    channelId: RESEARCH,
    state: "open",
    progress: { done: 0, total: 2 },
    assignment: { kind: "team", teamId: "team-research" },
  },
  {
    id: "ag-flags",
    day: "anytime",
    time: null,
    title: "Audit unused feature flags",
    channelId: TECH_DEBT,
    state: "open",
    progress: null,
    assignment: { kind: "none" },
  },
];

/** "8:30" → 510, for ordering and the now rule. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
