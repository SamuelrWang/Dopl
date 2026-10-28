/**
 * UI-STAGING FAKE DATA: recurring tasks, hard-coded over the staged identities in `../data.ts`.
 * A recurring task is a saved TEMPLATE: a title, subtasks each bound to one identity, and an
 * optional schedule. Launch starts those identities on it; the schedule starts them again.
 * Times are fixed labels (no clock), so the page reads the same on every load.
 * Nothing here is a product shape yet.
 */

import { STAGING_PEOPLE, STAGING_USER_ID } from "@/features/ui-staging/staging-stubs";

export interface RecurringSubtask {
  id: string;
  title: string;
  /** The identity that works this subtask. */
  identityId: string;
}

export type RecurringFrequency = "daily" | "weekdays" | "weekly";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface RecurringSchedule {
  /** Off = the template only runs when someone presses Launch. */
  on: boolean;
  frequency: RecurringFrequency;
  /** `weekly` only. */
  day: Weekday;
  /** 24h "HH:MM". */
  time: string;
}

export type RecurringRunResult = "running" | "done" | "failed";

export interface RecurringRun {
  id: string;
  /** "Today 9:00", "Mon 9:00". */
  when: string;
  /** "Scheduled" or the member who pressed Launch. */
  startedBy: string;
  result: RecurringRunResult;
  done: number;
  total: number;
}

export interface RecurringTask {
  id: string;
  title: string;
  description: string;
  /** "shared" = Shared in this channel; "home" = the viewer's Home space. */
  scope: "shared" | "home";
  createdBy: string;
  /** The identity that owns the task as a whole and reports when it is done. */
  leadId: string;
  subtasks: RecurringSubtask[];
  schedule: RecurringSchedule;
  /** The next scheduled start, as a label. `null` when the schedule is off. */
  nextRun: string | null;
  /** Newest first. */
  runs: RecurringRun[];
}

const GRACE = STAGING_PEOPLE[1].userId;

const OFF: RecurringSchedule = { on: false, frequency: "weekly", day: "Mon", time: "09:00" };

export const SEED_RECURRING_TASKS: RecurringTask[] = [
  {
    id: "rt-digest",
    title: "Monday digest",
    description: "Sums up last week in the channel and posts what is due this week.",
    scope: "shared",
    createdBy: STAGING_USER_ID,
    leadId: "id-chief",
    subtasks: [
      { id: "rt-digest-1", title: "Read last week's threads", identityId: "id-researcher" },
      { id: "rt-digest-2", title: "List open tasks and owners", identityId: "id-chief" },
      { id: "rt-digest-3", title: "Write and post the digest", identityId: "id-writer" },
    ],
    schedule: { on: true, frequency: "weekly", day: "Mon", time: "09:00" },
    nextRun: "Mon 9:00",
    runs: [
      { id: "run-d3", when: "Mon 9:00", startedBy: "Scheduled", result: "done", done: 3, total: 3 },
      { id: "run-d2", when: "Oct 19, 9:00", startedBy: "Scheduled", result: "done", done: 3, total: 3 },
      { id: "run-d1", when: "Oct 12, 9:00", startedBy: "Scheduled", result: "failed", done: 1, total: 3 },
    ],
  },
  {
    id: "rt-migrations",
    title: "Migration review",
    description: "Checks every migration merged today before it reaches production.",
    scope: "shared",
    createdBy: GRACE,
    leadId: "id-sql",
    subtasks: [
      { id: "rt-mig-1", title: "Diff today's migrations", identityId: "id-sql" },
      { id: "rt-mig-2", title: "Rerun the flaky schema tests", identityId: "id-flake" },
    ],
    schedule: { on: true, frequency: "weekdays", day: "Mon", time: "17:00" },
    nextRun: "Today 17:00",
    runs: [
      { id: "run-m2", when: "Today 11:40", startedBy: "Grace", result: "running", done: 1, total: 2 },
      { id: "run-m1", when: "Yesterday 17:00", startedBy: "Scheduled", result: "done", done: 2, total: 2 },
    ],
  },
  {
    id: "rt-cleanup",
    title: "Dependency cleanup",
    description: "Bumps outdated packages, fixes what breaks and opens one pull request.",
    scope: "home",
    createdBy: STAGING_USER_ID,
    leadId: "id-coder",
    subtasks: [
      { id: "rt-clean-1", title: "Bump outdated packages", identityId: "id-coder" },
      { id: "rt-clean-2", title: "Fix the failing tests", identityId: "id-coder" },
      { id: "rt-clean-3", title: "Write the change notes", identityId: "id-writer" },
    ],
    schedule: { on: true, frequency: "weekly", day: "Fri", time: "14:00" },
    nextRun: "Fri 14:00",
    runs: [
      { id: "run-c1", when: "Oct 23, 14:00", startedBy: "Scheduled", result: "done", done: 3, total: 3 },
    ],
  },
  {
    id: "rt-sources",
    title: "Source check",
    description: "Rechecks the links in the research notes and flags the ones that moved.",
    scope: "home",
    createdBy: STAGING_USER_ID,
    leadId: "id-researcher",
    subtasks: [{ id: "rt-src-1", title: "Open every cited link", identityId: "id-researcher" }],
    schedule: OFF,
    nextRun: null,
    runs: [],
  },
];
