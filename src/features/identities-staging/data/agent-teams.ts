/**
 * UI-STAGING FAKE DATA: agent teams (docs/specs/agent-teams/PROPOSAL.md §1–§2), hard-coded over
 * the staged identities in `../data.ts`. A team is slots (an identity, a label, 1–3 seats) and
 * task templates whose steps each bind to one slot. Nothing here is a product shape yet.
 */

import type { AgentColorKey } from "@dopl/contracts";
import { STAGING_PEOPLE, STAGING_USER_ID } from "@/features/ui-staging/staging-stubs";

export interface StagingTeamSlot {
  id: string;
  identityId: string;
  label: string;
  seats: number;
}

export interface StagingTeamStep {
  slotId: string;
  title: string;
  instructions: string;
}

export interface StagingTeamTemplate {
  id: string;
  title: string;
  description: string;
  steps: StagingTeamStep[];
}

export interface StagingAgentTeam {
  id: string;
  name: string;
  description: string;
  /** "shared" = Shared in this channel; "home" = the viewer's Home space. */
  scope: "shared" | "home";
  createdBy: string;
  slots: StagingTeamSlot[];
  templates: StagingTeamTemplate[];
}

/** A seat of a running team: the agent its slot launched, and what it is doing. */
export interface StagingTeamSeat {
  slotId: string;
  agentName: string;
  state: "working" | "idle" | "done";
  color: AgentColorKey;
}

export interface StagingTeamRun {
  teamId: string;
  templateId: string;
  channelName: string;
  /** Minutes before the page mounted. */
  startedAgo: number;
  seats: StagingTeamSeat[];
}

const GRACE = STAGING_PEOPLE[1].userId;

export const SEED_AGENT_TEAMS: StagingAgentTeam[] = [
  {
    id: "team-cleanup",
    name: "Code cleanup",
    description: "Tidies a module end to end: refactor, comment, then prove nothing broke.",
    scope: "home",
    createdBy: STAGING_USER_ID,
    slots: [
      { id: "slot-coder", identityId: "id-coder", label: "Coder", seats: 1 },
      { id: "slot-comments", identityId: "id-writer", label: "Comment writer", seats: 1 },
      { id: "slot-tester", identityId: "id-flake", label: "Code tester", seats: 1 },
    ],
    templates: [
      {
        id: "tpl-cleanup-pass",
        title: "Cleanup pass",
        description: "One module, one pull request. Behaviour must not change.",
        steps: [
          {
            slotId: "slot-coder",
            title: "Refactor the module",
            instructions:
              "Remove dead code and duplicated helpers in the module named in the brief. Keep every public signature. Small commits, typecheck after each.",
          },
          {
            slotId: "slot-comments",
            title: "Rewrite the comments",
            instructions:
              "Delete comments that restate the code. Keep one line for each non-obvious why. No history, no dates.",
          },
          {
            slotId: "slot-tester",
            title: "Prove nothing broke",
            instructions:
              "Run the module's tests and their neighbours ten times. Report any flake with its repro in the run thread.",
          },
        ],
      },
      {
        id: "tpl-dead-code",
        title: "Dead code sweep",
        description: "Find exports nothing imports and delete them with their tests.",
        steps: [
          {
            slotId: "slot-coder",
            title: "Delete unused exports",
            instructions: "Use the knip report. Delete each unused export and its test in one commit per file.",
          },
          {
            slotId: "slot-tester",
            title: "Run the full suite once",
            instructions: "Run the gate set from CLAUDE.md once at the end and post the result.",
          },
        ],
      },
    ],
  },
  {
    id: "team-research",
    name: "Research",
    description: "Two researchers split the sources, an editor turns the notes into one brief.",
    scope: "home",
    createdBy: STAGING_USER_ID,
    slots: [
      { id: "slot-research", identityId: "id-researcher", label: "Researcher", seats: 2 },
      { id: "slot-editor", identityId: "id-writer", label: "Editor", seats: 1 },
    ],
    templates: [
      {
        id: "tpl-brief",
        title: "Market brief",
        description: "A two-page brief on the topic in the launch line, with every claim sourced.",
        steps: [
          {
            slotId: "slot-research",
            title: "Collect primary sources",
            instructions: "Split the topic in half by seat. File each source with a one-line summary in the Ideas folder.",
          },
          {
            slotId: "slot-editor",
            title: "Write the brief",
            instructions: "Merge both researchers' notes into two pages. Cut anything without a source.",
          },
        ],
      },
    ],
  },
  {
    id: "team-hiring",
    name: "Hiring",
    description: "Screens the week's applicants and books the loops.",
    scope: "home",
    createdBy: STAGING_USER_ID,
    slots: [
      { id: "slot-screen", identityId: "id-recruiter", label: "Screener", seats: 2 },
      { id: "slot-sched", identityId: "id-chief", label: "Scheduler", seats: 1 },
    ],
    templates: [
      {
        id: "tpl-weekly-screen",
        title: "Weekly screen",
        description: "Every new applicant scored against the platform role brief.",
        steps: [
          {
            slotId: "slot-screen",
            title: "Score applicants",
            instructions: "Score each applicant against the role brief, 1 to 5, with one sentence of evidence per score.",
          },
          {
            slotId: "slot-sched",
            title: "Book the loops",
            instructions: "Book a loop for every 4 or 5. Post the calendar in the run thread.",
          },
        ],
      },
    ],
  },
  {
    id: "team-release",
    name: "Release",
    description: "Cuts the build, checks every migration, writes the notes.",
    scope: "shared",
    createdBy: GRACE,
    slots: [
      { id: "slot-captain", identityId: "id-release", label: "Release captain", seats: 1 },
      { id: "slot-sql", identityId: "id-sql", label: "Migration reviewer", seats: 1 },
      { id: "slot-notes", identityId: "id-postmortem", label: "Notes writer", seats: 1 },
    ],
    templates: [
      {
        id: "tpl-cut",
        title: "Cut a release",
        description: "From a green master to published notes.",
        steps: [
          {
            slotId: "slot-sql",
            title: "Verify migrations",
            instructions: "Match every pending migration by name and md5 against production. Stop on any mismatch.",
          },
          {
            slotId: "slot-captain",
            title: "Cut and publish",
            instructions: "Walk the deploy runbook in order. Stop at the first red gate and post it.",
          },
          {
            slotId: "slot-notes",
            title: "Write the release notes",
            instructions: "Group merged changes by surface. One plain sentence each.",
          },
        ],
      },
      {
        id: "tpl-hotfix",
        title: "Hotfix",
        description: "One fix, straight to production.",
        steps: [
          {
            slotId: "slot-captain",
            title: "Ship the fix",
            instructions: "Cherry-pick the named commit onto the release branch and run the deploy runbook.",
          },
        ],
      },
    ],
  },
  {
    id: "team-flakes",
    name: "Flaky test sweep",
    description: "Two hunters reproduce, a reviewer checks the fixtures they touch.",
    scope: "shared",
    createdBy: STAGING_USER_ID,
    slots: [
      { id: "slot-hunter", identityId: "id-flake", label: "Flake hunter", seats: 2 },
      { id: "slot-review", identityId: "id-sql", label: "Fixture reviewer", seats: 1 },
    ],
    templates: [
      {
        id: "tpl-sweep",
        title: "Sweep the suite",
        description: "The four flakiest tests, fixed or quarantined with a cause.",
        steps: [
          {
            slotId: "slot-hunter",
            title: "Reproduce and fix",
            instructions: "Take two tests per seat from the ranking. Rerun until you can name the cause.",
          },
          {
            slotId: "slot-review",
            title: "Review fixture changes",
            instructions: "Read every fixture change before it merges. Clocks and seeds must reset.",
          },
        ],
      },
    ],
  },
];

/** The one team running when the page opens: Code cleanup's Cleanup pass in #tech-debt. */
export const SEED_TEAM_RUN: StagingTeamRun = {
  teamId: "team-cleanup",
  templateId: "tpl-cleanup-pass",
  channelName: "tech-debt",
  startedAgo: 12,
  seats: [
    { slotId: "slot-coder", agentName: "Coder", state: "done", color: "agent-14" },
    { slotId: "slot-comments", agentName: "Comment Writer", state: "working", color: "agent-06" },
    { slotId: "slot-tester", agentName: "Code Tester", state: "idle", color: "agent-10" },
  ],
};
