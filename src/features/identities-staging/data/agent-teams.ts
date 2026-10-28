/**
 * UI-STAGING FAKE DATA: agent teams (docs/specs/agent-teams/PROPOSAL.md §1–§2), hard-coded over
 * the staged identities in `../data.ts`. A team is a roster: slots (an identity, a label, 1 to 3
 * seats). It holds no saved tasks; it launches with a free goal. Nothing here is a product shape yet.
 */

import type { AgentColorKey } from "@dopl/contracts";
import { STAGING_PEOPLE, STAGING_USER_ID } from "@/features/ui-staging/staging-stubs";

export interface StagingTeamSlot {
  id: string;
  identityId: string;
  label: string;
  seats: number;
}

export interface StagingAgentTeam {
  id: string;
  name: string;
  description: string;
  /** "shared" = Shared in this channel; "home" = the viewer's Home space. */
  scope: "shared" | "home";
  createdBy: string;
  slots: StagingTeamSlot[];
  /**
   * Optional lead: one identity from the roster that splits and manages the work. `null` = the
   * members organize themselves.
   */
  leadIdentityId: string | null;
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
  /** The free goal the team was launched with. */
  goal: string;
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
    leadIdentityId: null,
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
    leadIdentityId: "id-writer",
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
    leadIdentityId: "id-chief",
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
    leadIdentityId: "id-release",
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
    leadIdentityId: null,
  },
];

/** The one team running when the page opens: Code cleanup, launched with a goal into #tech-debt. */
export const SEED_TEAM_RUN: StagingTeamRun = {
  teamId: "team-cleanup",
  goal: "Clean up the billing module before Friday's release.",
  channelName: "tech-debt",
  startedAgo: 12,
  seats: [
    { slotId: "slot-coder", agentName: "Coder", state: "done", color: "agent-14" },
    { slotId: "slot-comments", agentName: "Comment Writer", state: "working", color: "agent-06" },
    { slotId: "slot-tester", agentName: "Code Tester", state: "idle", color: "agent-10" },
  ],
};
