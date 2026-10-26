/**
 * MOCK CONTENT FOR THE VIEW POPUP'S THREE NON-STORED TABS (item 2d; staging data layer, never
 * ported).
 *
 * ⚠ **THREE OF THESE FOUR THINGS ARE NOT FIELDS ON AN IDENTITY TODAY.** `AgentIdentity` holds
 * name, description, instructions, runtime, model, visibility, teams, fields and knowledge, and
 * nothing else — so tools, rules and escalations are mock, and the view popup is showing Samuel
 * what the tabs would hold rather than reading anything. The landing sells all three
 * (`marketing/components/multiplayer-content.ts › MULTIPLAYER_COPY.rules`, `.identity.tools`), and
 * `Plans/Identities Page Ideas 2026-10-22` §C11 is the open call on making them real.
 *
 * The activity log and the running list are different: both already exist in the product as data
 * (the audit trail, and the live session list keyed by `identityName`), just unjoined to an
 * identity. Their shape here follows the landing's Monitoring log
 * (`marketing/components/control-content.ts › LOG_ROWS`): what it did, where, when, and under
 * which permission.
 *
 * Copy voice: `docs/DESIGN-LANGUAGE.md` §6 — specific, no buzzwords, no em dashes.
 */

/** A tool or integration an identity may call. `mark` names a lucide glyph the view maps. */
export interface IdentityToolMock {
  name: string;
  /** Which glyph draws it (`identity-view-dialog.tsx › TOOL_GLYPH`). */
  mark: "repo" | "terminal" | "channels" | "calendar" | "sheet" | "mail" | "glasses" | "search";
  /** `false` = connected to the workspace but not granted to this identity. */
  allowed: boolean;
  /** What it lets this identity do, one short phrase. */
  does: string;
}

/** One line of a rule or an escalation. Deliberately a sentence, not a structure. */
export type IdentityRuleMock = string;

export interface IdentityLogMock {
  /** What it did, in the past tense. */
  did: string;
  /** Where it happened: a channel, a knowledge base, a device. */
  where?: string;
  /**
   * ⚠ MINUTES AGO, NOT A CLOCK TIME, and that is load-bearing twice over: it SORTS (the page-level
   * feed interleaves every identity's rows, and wall-clock strings cannot be ordered), and it is
   * hydration-safe (a relative label derived from a constant never differs between the server and
   * the client render, which a label computed against `Date.now()` does).
   */
  at: number;
  /** `auto` draws no chip: it is the ordinary case and a chip on every row is noise. */
  permission: "auto" | "approved" | "waiting" | "paused";
}

export interface IdentityRunMock {
  /** The agent's display name, which is the agent's, not the identity's. */
  agent: string;
  channel: string;
  thread: string;
  /** How long it has been working. */
  since: string;
}

interface IdentityViewMock {
  tools: ReadonlyArray<IdentityToolMock>;
  rules: ReadonlyArray<IdentityRuleMock>;
  escalations: ReadonlyArray<IdentityRuleMock>;
  log: ReadonlyArray<IdentityLogMock>;
  running: ReadonlyArray<IdentityRunMock>;
}

const EMPTY: IdentityViewMock = {
  tools: [],
  rules: [],
  escalations: [],
  log: [],
  running: [],
};

/** Keyed by the seed ids in `../data.ts`. A row with no entry gets {@link EMPTY}, which is how the
 *  empty state of every tab stays reachable (the Writer row has nothing anywhere). */
const MOCKS: Record<string, IdentityViewMock> = {
  "id-release": {
    tools: [
      { name: "GitHub", mark: "repo", allowed: true, does: "Reads the release branch and cuts the tag" },
      { name: "Dopl channels", mark: "channels", allowed: true, does: "Posts the notes when the build is green" },
      { name: "Calendar", mark: "calendar", allowed: false, does: "Would hold the release window" },
    ],
    rules: [
      "Walk the checklist in order and stop at the first red gate",
      "Never cut a release on a Friday",
      "Post the notes in #releases, never in a thread",
    ],
    escalations: ["A gate that fails twice", "Any change to a migration"],
    log: [
      { did: "Cut 1.7.24 and posted the notes", where: "#releases", at: 42, permission: "auto" },
      { did: "Held the build on a red typecheck", where: "#tech-debt", at: 68, permission: "waiting" },
      { did: "Reran the flaky device suite", where: "GitHub", at: 80, permission: "approved" },
      { did: "Read the deploy runbook", where: "Platform Runbooks", at: 89, permission: "auto" },
    ],
    running: [
      { agent: "Release Captain", channel: "#releases", thread: "Cut 1.7.24", since: "40m" },
    ],
  },
  "id-postmortem": {
    tools: [
      { name: "Dopl channels", mark: "channels", allowed: true, does: "Reads the incident thread end to end" },
      { name: "GitHub", mark: "repo", allowed: true, does: "Reads the deploy log around the incident" },
    ],
    rules: [
      "Name systems and decisions, never people",
      "Every claim cites the message or the commit it came from",
    ],
    escalations: ["An incident still open after 24 hours"],
    log: [
      { did: "Drafted the postmortem for the 09-18 outage", where: "Postmortems", at: 310, permission: "auto" },
      { did: "Pulled the deploy log for 09-18", where: "GitHub", at: 323, permission: "auto" },
    ],
    running: [],
  },
  "id-sql": {
    tools: [
      { name: "GitHub", mark: "repo", allowed: true, does: "Reads every migration in the diff" },
      { name: "Terminal", mark: "terminal", allowed: false, does: "Would run the migration locally" },
    ],
    rules: [
      "Read every migration byte for byte before approving",
      "Refuse a destructive statement with no down path",
    ],
    escalations: ["A drop or a rename on a live table", "Anything that rewrites data in place"],
    log: [
      { did: "Approved 0142_add_identity_shelf", where: "#tech-debt", at: 18, permission: "approved" },
      { did: "Refused 0141 for a missing down path", where: "#tech-debt", at: 22, permission: "auto" },
      { did: "Compared the v1 and v2 payloads", where: "Migrations", at: 36, permission: "auto" },
    ],
    running: [
      { agent: "SQL Reviewer", channel: "#tech-debt", thread: "Teardown order fix", since: "15m" },
      { agent: "Schema Diff", channel: "#api-v2-migration", thread: "Payload parity", since: "6m" },
    ],
  },
  "id-coder": {
    tools: [
      { name: "GitHub", mark: "repo", allowed: true, does: "Reads the repo and opens pull requests" },
      { name: "Terminal", mark: "terminal", allowed: true, does: "Runs the typecheck and the targeted tests" },
      { name: "Dopl channels", mark: "channels", allowed: true, does: "Reports where the work got to" },
    ],
    rules: [
      "Read INVARIANTS before the first edit",
      "Keep diffs small and run the targeted typecheck before saying done",
      "Never push to master",
    ],
    escalations: ["A schema change", "Anything that touches billing"],
    log: [
      { did: "Rebuilt the identity card", where: "#tech-debt", at: 4, permission: "auto" },
      { did: "Ran the typecheck and the staging lint", where: "Terminal", at: 7, permission: "auto" },
      { did: "Opened a worktree for the card work", where: "Terminal", at: 30, permission: "approved" },
      { did: "Read the design language", where: "Platform Runbooks", at: 45, permission: "auto" },
    ],
    running: [
      { agent: "Identity Cards", channel: "#tech-debt", thread: "Card overhaul", since: "5m" },
    ],
  },
  "id-researcher": {
    tools: [
      { name: "Web search", mark: "search", allowed: true, does: "Finds primary sources and quotes them" },
      { name: "Dopl knowledge", mark: "sheet", allowed: true, does: "Files the notes where the team reads them" },
    ],
    rules: ["Quote a primary source or say there is none", "File every note under Ideas"],
    escalations: ["A source behind a paywall"],
    log: [
      { did: "Filed 4 notes on agent pricing", where: "Ideas", at: 400, permission: "auto" },
      { did: "Paused by you", at: 397, permission: "paused" },
    ],
    running: [],
  },
  "id-recruiter": {
    tools: [
      { name: "Mail", mark: "mail", allowed: true, does: "Replies to candidates and books loops" },
      { name: "Calendar", mark: "calendar", allowed: true, does: "Holds the interview slots" },
    ],
    rules: ["Screen against the role brief, never against a résumé alone", "Never discuss compensation"],
    escalations: ["A candidate asking about compensation", "A referral from the team"],
    log: [
      { did: "Booked 2 loops for the platform role", where: "Calendar", at: 2600, permission: "auto" },
      { did: "Screened 6 candidates against the brief", where: "Hiring", at: 2740, permission: "auto" },
    ],
    running: [],
  },
  "id-critic": {
    tools: [
      { name: "Dopl channels", mark: "channels", allowed: true, does: "Reads the screen posted for review" },
      { name: "Dopl knowledge", mark: "sheet", allowed: true, does: "Quotes the rule a screen breaks" },
    ],
    rules: [
      "Name the rule, never a preference",
      "One finding per screen, the worst one",
    ],
    escalations: ["A rule the design language does not cover"],
    log: [
      { did: "Flagged the devices band for grey-on-grey", where: "#design-review", at: 55, permission: "auto" },
      { did: "Quoted rule 1 on the overview panels", where: "Platform Runbooks", at: 61, permission: "auto" },
    ],
    running: [],
  },
  "id-flake": {
    tools: [
      { name: "GitHub", mark: "repo", allowed: true, does: "Reruns the suite on the failing commit" },
      { name: "Terminal", mark: "terminal", allowed: true, does: "Runs one test in a loop" },
    ],
    rules: ["Rerun ten times before calling it flaky", "Never quarantine without a reason line"],
    escalations: ["A test that fails the same way every run"],
    log: [
      { did: "Quarantined device-token-expiry after 10 reruns", where: "#flaky-tests", at: 9, permission: "approved" },
      { did: "Reran the channels suite 10 times", where: "Terminal", at: 25, permission: "auto" },
    ],
    running: [
      { agent: "Flake Hunter", channel: "#flaky-tests", thread: "Device token expiry", since: "3m" },
    ],
  },
  "id-chief": {
    tools: [
      { name: "Calendar", mark: "calendar", allowed: true, does: "Reads the week and finds the gaps" },
      { name: "Dopl channels", mark: "channels", allowed: true, does: "Chases the follow-ups it posted" },
      { name: "Glasses", mark: "glasses", allowed: true, does: "Briefs you on the way into a meeting" },
    ],
    rules: ["Post the digest on Monday morning", "Chase a follow-up twice, then escalate"],
    escalations: ["A follow-up ignored twice", "Anything that moves a customer meeting"],
    log: [
      { did: "Posted the Monday digest", where: "#tech-debt", at: 470, permission: "auto" },
      { did: "Chased 3 follow-ups from last week", where: "#tech-debt", at: 467, permission: "auto" },
      { did: "Briefed you before the Acme call", where: "Glasses", at: 345, permission: "auto" },
    ],
    running: [],
  },
};

/** "4m ago" from {@link IdentityLogMock.at}. One formatter, both surfaces. */
export function agoLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (60 * 24))}d ago`;
}

export function identityViewMock(identityId: string): IdentityViewMock {
  return MOCKS[identityId] ?? EMPTY;
}
