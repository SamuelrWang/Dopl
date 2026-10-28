/**
 * UI-STAGING FAKE DATA: saved tasks for the Tasks page, hard-coded over the staged identities
 * (`identities-staging/data.ts`) and agent teams (`identities-staging/data/agent-teams.ts`).
 *
 * A saved task is a reusable job: a title, ordered steps, an optional schedule. Assignment is
 * LOOSE (Samuel, 2026-10-28): the task may name a team, a set of identities, or nobody; a step may
 * pin one identity or stay unpinned, and then the agents decide who takes it (the team's lead
 * decides when it has one). Times are fixed labels, so the page reads the same on every load.
 * Nothing here is a product shape yet.
 */

import { STAGING_PEOPLE, STAGING_USER_ID } from "@/features/ui-staging/staging-stubs";
import { STAGING_TASK_CHANNELS } from "./channels";

/** Who the task goes to as a whole. `none` = launch asks, or the channel's agents pick it up. */
export type TaskAssignment =
  | { kind: "none" }
  | { kind: "team"; teamId: string }
  | { kind: "identities"; identityIds: string[] };

export interface SavedStep {
  id: string;
  title: string;
  /** Pinned = that identity does this step. `null` = the agents decide. */
  pinnedIdentityId: string | null;
}

export type RecurringFrequency = "daily" | "weekdays" | "weekly";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface RecurringSchedule {
  /** Off = the task only runs when someone presses Launch. */
  on: boolean;
  frequency: RecurringFrequency;
  /** `weekly` only. */
  day: Weekday;
  /** 24h "HH:MM". */
  time: string;
}

/**
 * `missed` = a scheduled start passed while the operator's desktop app was closed.
 * `needs_you` = an agent in the run is waiting on a person.
 */
export type RunResult = "running" | "done" | "failed" | "missed" | "needs_you";

export interface SavedRun {
  id: string;
  /** "Today 9:00", "Mon 9:00". */
  when: string;
  /** "Scheduled" or the member who pressed Launch. */
  startedBy: string;
  result: RunResult;
  done: number;
  total: number;
}

export interface SavedTask {
  id: string;
  /** "saved" = reusable, may repeat. "one-off" = a channel task done once. */
  kind: "saved" | "one-off";
  /** One-off only: when it is due, as a label ("Today 14:00"); `null` = anytime. */
  due?: string | null;
  title: string;
  description: string;
  /** "shared" = shared in its channel; "home" = the viewer's own. */
  scope: "shared" | "home";
  /** The channel it launches into. */
  channelId: string;
  createdBy: string;
  assignment: TaskAssignment;
  steps: SavedStep[];
  schedule: RecurringSchedule;
  /** The next scheduled start, as a label. `null` when the schedule is off. */
  nextRun: string | null;
  /** Newest first. */
  runs: SavedRun[];
}

const GRACE = STAGING_PEOPLE[1].userId;
const [TECH_DEBT, RELEASES, RESEARCH] = STAGING_TASK_CHANNELS.map((c) => c.id);

const OFF: RecurringSchedule = { on: false, frequency: "weekly", day: "Mon", time: "09:00" };

export const SEED_SAVED_TASKS: SavedTask[] = [
  {
    kind: "saved",
    id: "st-standup",
    title: "Standup notes",
    description: "Reads yesterday's threads and posts who did what and what is blocked.",
    scope: "home",
    channelId: TECH_DEBT,
    createdBy: STAGING_USER_ID,
    assignment: { kind: "identities", identityIds: ["id-chief"] },
    steps: [
      { id: "st-stand-1", title: "Read yesterday's threads", pinnedIdentityId: null },
      { id: "st-stand-2", title: "Post the notes", pinnedIdentityId: "id-chief" },
    ],
    schedule: { on: true, frequency: "weekdays", day: "Mon", time: "08:30" },
    nextRun: "Tomorrow 8:30",
    runs: [
      { id: "run-s2", when: "Today 8:30", startedBy: "Scheduled", result: "missed", done: 0, total: 2 },
      { id: "run-s1", when: "Yesterday 8:30", startedBy: "Scheduled", result: "done", done: 2, total: 2 },
    ],
  },
  {
    kind: "saved",
    id: "st-digest",
    title: "Monday digest",
    description: "Sums up last week in the channel and posts what is due this week.",
    scope: "shared",
    channelId: TECH_DEBT,
    createdBy: STAGING_USER_ID,
    assignment: { kind: "identities", identityIds: ["id-chief", "id-researcher", "id-writer"] },
    steps: [
      { id: "st-digest-1", title: "Read last week's threads", pinnedIdentityId: "id-researcher" },
      { id: "st-digest-2", title: "List open tasks and owners", pinnedIdentityId: null },
      { id: "st-digest-3", title: "Write and post the digest", pinnedIdentityId: "id-writer" },
    ],
    schedule: { on: true, frequency: "weekly", day: "Mon", time: "09:00" },
    nextRun: "Mon 9:00",
    runs: [
      { id: "run-d3", when: "Mon 9:00", startedBy: "Scheduled", result: "missed", done: 0, total: 3 },
      { id: "run-d2", when: "Oct 19, 9:00", startedBy: "Scheduled", result: "done", done: 3, total: 3 },
      { id: "run-d1", when: "Oct 12, 9:00", startedBy: "Scheduled", result: "failed", done: 1, total: 3 },
    ],
  },
  {
    kind: "saved",
    id: "st-release",
    title: "Cut a release",
    description: "From a green master to published notes, every migration checked first.",
    scope: "shared",
    channelId: RELEASES,
    createdBy: GRACE,
    assignment: { kind: "team", teamId: "team-release" },
    steps: [
      { id: "st-rel-1", title: "Verify migrations", pinnedIdentityId: "id-sql" },
      { id: "st-rel-2", title: "Cut and publish", pinnedIdentityId: null },
      { id: "st-rel-3", title: "Write the release notes", pinnedIdentityId: null },
    ],
    schedule: { on: true, frequency: "weekly", day: "Thu", time: "15:00" },
    nextRun: "Thu 15:00",
    runs: [
      { id: "run-r2", when: "Today 11:40", startedBy: "Grace", result: "running", done: 1, total: 3 },
      { id: "run-r1", when: "Oct 22, 15:00", startedBy: "Scheduled", result: "done", done: 3, total: 3 },
    ],
  },
  {
    kind: "saved",
    id: "st-migrations",
    title: "Migration review",
    description: "Checks every migration merged today before it reaches production.",
    scope: "shared",
    channelId: TECH_DEBT,
    createdBy: GRACE,
    assignment: { kind: "identities", identityIds: ["id-sql", "id-flake"] },
    steps: [
      { id: "st-mig-1", title: "Diff today's migrations", pinnedIdentityId: "id-sql" },
      { id: "st-mig-2", title: "Rerun the flaky schema tests", pinnedIdentityId: "id-flake" },
    ],
    schedule: { on: true, frequency: "weekdays", day: "Mon", time: "17:00" },
    nextRun: "Today 17:00",
    runs: [
      { id: "run-m1", when: "Yesterday 17:00", startedBy: "Scheduled", result: "done", done: 2, total: 2 },
    ],
  },
  {
    kind: "saved",
    id: "st-brief",
    title: "Market brief",
    description: "A two-page brief on one topic, every claim sourced.",
    scope: "home",
    channelId: RESEARCH,
    createdBy: STAGING_USER_ID,
    assignment: { kind: "team", teamId: "team-research" },
    steps: [
      { id: "st-brief-1", title: "Collect primary sources", pinnedIdentityId: null },
      { id: "st-brief-2", title: "Write the brief", pinnedIdentityId: null },
    ],
    schedule: OFF,
    nextRun: null,
    runs: [
      { id: "run-b1", when: "Oct 20, 10:12", startedBy: "You", result: "done", done: 2, total: 2 },
    ],
  },
  {
    kind: "saved",
    id: "st-cleanup",
    title: "Dependency cleanup",
    description: "Bumps outdated packages, fixes what breaks and opens one pull request.",
    scope: "home",
    channelId: TECH_DEBT,
    createdBy: STAGING_USER_ID,
    assignment: { kind: "none" },
    steps: [
      { id: "st-clean-1", title: "Bump outdated packages", pinnedIdentityId: null },
      { id: "st-clean-2", title: "Fix the failing tests", pinnedIdentityId: null },
      { id: "st-clean-3", title: "Write the change notes", pinnedIdentityId: null },
    ],
    schedule: { on: true, frequency: "weekly", day: "Fri", time: "14:00" },
    nextRun: "Fri 14:00",
    runs: [
      { id: "run-c1", when: "Oct 23, 14:00", startedBy: "Scheduled", result: "done", done: 3, total: 3 },
    ],
  },
  // One-off channel tasks: no schedule, one run at most.
  {
    kind: "one-off",
    id: "oo-flaky",
    title: "Fix the flaky checkout test",
    description: "The checkout test fails one run in ten on CI. Find why and fix it.",
    scope: "shared",
    channelId: TECH_DEBT,
    createdBy: STAGING_USER_ID,
    due: "Today 10:00",
    assignment: { kind: "identities", identityIds: ["id-flake"] },
    steps: [
      { id: "oo-flaky-1", title: "Reproduce the failure", pinnedIdentityId: "id-flake" },
      { id: "oo-flaky-2", title: "Fix the fixture clock", pinnedIdentityId: "id-flake" },
    ],
    schedule: OFF,
    nextRun: null,
    runs: [{ id: "run-oo-f", when: "Today 10:00", startedBy: "You", result: "done", done: 2, total: 2 }],
  },
  {
    kind: "one-off",
    id: "oo-pricing",
    title: "Review the pricing page copy",
    description: "Tighten the pricing page and flag any claim we cannot back.",
    scope: "home",
    channelId: RESEARCH,
    createdBy: STAGING_USER_ID,
    due: "Today 14:00",
    assignment: { kind: "identities", identityIds: ["id-writer"] },
    steps: [
      { id: "oo-pr-1", title: "Rewrite the plan blurbs", pinnedIdentityId: "id-writer" },
      { id: "oo-pr-2", title: "Check every claim with you", pinnedIdentityId: null },
    ],
    schedule: OFF,
    nextRun: null,
    runs: [
      { id: "run-oo-p", when: "Today 11:05", startedBy: "You", result: "needs_you", done: 1, total: 2 },
    ],
  },
  {
    kind: "one-off",
    id: "oo-env",
    title: "Rename the billing env vars",
    description: "Move every billing variable to the BILLING_ prefix in one pull request.",
    scope: "home",
    channelId: TECH_DEBT,
    createdBy: STAGING_USER_ID,
    due: null,
    assignment: { kind: "identities", identityIds: ["id-coder"] },
    steps: [
      { id: "oo-env-1", title: "List every billing variable", pinnedIdentityId: "id-coder" },
      { id: "oo-env-2", title: "Rename them", pinnedIdentityId: "id-coder" },
      { id: "oo-env-3", title: "Update the deploy docs", pinnedIdentityId: null },
    ],
    schedule: OFF,
    nextRun: null,
    runs: [{ id: "run-oo-e", when: "Today 9:20", startedBy: "You", result: "running", done: 1, total: 3 }],
  },
  {
    kind: "one-off",
    id: "oo-roadmap",
    title: "Draft the Q4 roadmap",
    description: "One page, three bets, each with the number it should move.",
    scope: "shared",
    channelId: RESEARCH,
    createdBy: GRACE,
    due: null,
    assignment: { kind: "team", teamId: "team-research" },
    steps: [
      { id: "oo-rm-1", title: "Collect last quarter's numbers", pinnedIdentityId: null },
      { id: "oo-rm-2", title: "Write the draft", pinnedIdentityId: null },
    ],
    schedule: OFF,
    nextRun: null,
    runs: [],
  },
  {
    kind: "one-off",
    id: "oo-flags",
    title: "Audit unused feature flags",
    description: "List flags nothing reads and propose which to delete.",
    scope: "home",
    channelId: TECH_DEBT,
    createdBy: STAGING_USER_ID,
    due: null,
    assignment: { kind: "none" },
    steps: [{ id: "oo-fl-1", title: "List every flag and its readers", pinnedIdentityId: null }],
    schedule: OFF,
    nextRun: null,
    runs: [],
  },
];
