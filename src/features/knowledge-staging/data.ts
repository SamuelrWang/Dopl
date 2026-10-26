/**
 * UI-STAGING FAKE DATA for /knowledge — every base, folder, entry, grant, team, member and
 * revision the staged /home → Knowledge face renders. Pure data: no Supabase, no fetch, no
 * Electron bridge. `fake-store.ts` clones this into a mutable in-memory DB on page mount, so a
 * reload restores exactly this.
 */

import type {
  ChannelGrantChannelRef,
  ChannelResourceGrant,
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";
import type { TeamView } from "@/features/teams/types";
import type { Revision } from "@/features/revisions/types";
import type { Role } from "@/features/workspaces/types";
import {
  STAGING_HOME_SEGMENT,
  STAGING_HOME_WORKSPACE_ID,
  STAGING_PEOPLE,
  STAGING_USER_ID,
  daysAgoIso,
  minsAgoIso,
} from "@/features/ui-staging/staging-stubs";
import {
  ROLLBACK,
  DEPLOY,
  MIGRATIONS,
  ESCALATION,
  HANDOFF,
  PM_SEARCH,
  PM_SIGNOUT,
  STANDUP,
  ONE_ON_ONE,
  IDEA_GLASSES,
  ROLE_BRIEF,
  LOOP_ONSITE,
  READING,
  MIG_PLAN,
} from "./data-bodies";

export { STAGING_HOME_SEGMENT, STAGING_HOME_WORKSPACE_ID, STAGING_USER_ID };

// ─── The selected channel ────────────────────────────────────────────

/**
 * The subset of `@/features/channels/types › Channel` the Knowledge face reads. A staging type
 * instead of a cast of the full ~40-field row: the panels only touch these.
 */
export interface StagingChannel {
  id: string;
  /** The channel's link CONTAINER (where shared bases live). */
  workspaceId: string;
  name: string;
  isDirect: boolean;
  /** The caller's WORKSPACE role in the container (`Channel.myWorkspaceRole`). */
  myWorkspaceRole: Role;
  container: { segment: string };
  peers: ReadonlyArray<{ userId: string; displayName: string | null }>;
}

export const GRACE = STAGING_PEOPLE[1];
export const ANTHONY = STAGING_PEOPLE[2];

export const CONTAINER_WORKSPACE_ID = "staging-container-tech-debt";
export const CHANNEL_ID = "staging-channel-tech-debt";

export const STAGING_CHANNEL: StagingChannel = {
  id: CHANNEL_ID,
  workspaceId: CONTAINER_WORKSPACE_ID,
  name: "tech-debt",
  isDirect: false,
  myWorkspaceRole: "owner",
  container: { segment: "tech-debt-7f3a" },
  peers: [
    { userId: GRACE.userId, displayName: GRACE.displayName ?? null },
    { userId: ANTHONY.userId, displayName: ANTHONY.displayName ?? null },
  ],
};

/** Every channel the operator can lend a base into (the settings modal's Channels section). */
export const GRANTABLE_CHANNELS: ChannelGrantChannelRef[] = [
  { id: CHANNEL_ID, name: "tech-debt", isDirect: false },
  { id: "staging-channel-q4-outbound", name: "q4-outbound", isDirect: false },
  { id: "staging-channel-dm-grace", name: "Grace Kim", isDirect: true },
];

/** Who is in each channel — the "Let guests edit" toggle only shows when a guest is present. */
export const CHANNEL_ROSTERS: Record<
  string,
  Array<{ userId: string; displayName: string; workspaceRole: Role }>
> = {
  [CHANNEL_ID]: [
    { userId: STAGING_USER_ID, displayName: "Daniel Ortiz", workspaceRole: "owner" },
    { userId: GRACE.userId, displayName: "Grace Kim", workspaceRole: "member" },
    { userId: ANTHONY.userId, displayName: "Anthony Reyes", workspaceRole: "guest" },
  ],
  "staging-channel-q4-outbound": [
    { userId: STAGING_USER_ID, displayName: "Daniel Ortiz", workspaceRole: "owner" },
    { userId: GRACE.userId, displayName: "Grace Kim", workspaceRole: "member" },
  ],
  "staging-channel-dm-grace": [
    { userId: STAGING_USER_ID, displayName: "Daniel Ortiz", workspaceRole: "owner" },
    { userId: GRACE.userId, displayName: "Grace Kim", workspaceRole: "guest" },
  ],
};

export const OWNER_NAMES: Record<string, string> = {
  [STAGING_USER_ID]: "Daniel Ortiz",
  [GRACE.userId]: "Grace Kim",
  [ANTHONY.userId]: "Anthony Reyes",
};

/** Per-base storage cap (bytes) — the card meter and the settings meter read it. */
export const KB_STORAGE_LIMIT = 50 * 1024 * 1024;

// ─── Builders ────────────────────────────────────────────────────────

function base(
  id: string,
  workspaceId: string,
  name: string,
  description: string,
  createdBy: string,
  opts: Partial<KnowledgeBase> = {}
): KnowledgeBase {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return {
    id,
    workspaceId,
    name,
    slug,
    publicId: id.slice(-6),
    description,
    agentWriteEnabled: true,
    visibility: "private",
    accessMode: "workspace",
    createdBy,
    createdAt: daysAgoIso(40),
    updatedAt: daysAgoIso(2),
    deletedAt: null,
    ...opts,
  };
}

function folder(
  id: string,
  b: KnowledgeBase,
  name: string,
  parentId: string | null,
  position: number,
  description: string | null = null
): KnowledgeFolder {
  return {
    id,
    workspaceId: b.workspaceId,
    knowledgeBaseId: b.id,
    parentId,
    name,
    description,
    position,
    createdBy: b.createdBy,
    createdAt: daysAgoIso(30),
    updatedAt: daysAgoIso(5),
    deletedAt: null,
  };
}

function entry(
  id: string,
  b: KnowledgeBase,
  folderId: string | null,
  title: string,
  excerpt: string | null,
  body: string,
  position: number,
  opts: Partial<KnowledgeEntry> = {}
): KnowledgeEntry {
  return {
    id,
    workspaceId: b.workspaceId,
    knowledgeBaseId: b.id,
    folderId,
    title,
    excerpt,
    body,
    entryType: "doc",
    position,
    createdBy: b.createdBy,
    lastEditedBy: b.createdBy,
    lastEditedSource: "user",
    createdAt: daysAgoIso(20),
    updatedAt: daysAgoIso(1),
    deletedAt: null,
    ...opts,
  };
}

// ─── Shared in #tech-debt (the link container) ───────────────────────

const runbooks = base(
  "kb-runbooks",
  CONTAINER_WORKSPACE_ID,
  "Platform Runbooks",
  "Step-by-step procedures for deploys, rollbacks and on-call escalations.",
  GRACE.userId,
  { visibility: "public" }
);
const postmortems = base(
  "kb-postmortems",
  CONTAINER_WORKSPACE_ID,
  "Incident Postmortems",
  "Blameless write-ups of every Sev-1 and Sev-2 since the March migration.",
  STAGING_USER_ID,
  { visibility: "public", agentWriteEnabled: false }
);
const migration = base(
  "kb-migration",
  CONTAINER_WORKSPACE_ID,
  "Postgres 17 Migration",
  "Working notes for the database upgrade. Not shared into any channel yet.",
  STAGING_USER_ID,
  { visibility: "public" }
);

// ─── Personal (the operator's home shelf) ────────────────────────────

const notes = base(
  "kb-notes",
  STAGING_HOME_WORKSPACE_ID,
  "Working Notes",
  "Daily scratchpad, meeting notes and half-formed ideas.",
  STAGING_USER_ID
);
const hiring = base(
  "kb-hiring",
  STAGING_HOME_WORKSPACE_ID,
  "Hiring Pipeline",
  "Interview loops, scorecards and the platform-team role brief.",
  STAGING_USER_ID
);
const reading = base(
  "kb-reading",
  STAGING_HOME_WORKSPACE_ID,
  "Reading List",
  null as unknown as string,
  STAGING_USER_ID,
  { description: null }
);

export const SEED_BASES: KnowledgeBase[] = [
  runbooks,
  postmortems,
  migration,
  notes,
  hiring,
  reading,
];

/** `(base, channel)` grants — what puts a container base in "Shared in this channel". */
export const SEED_CHANNEL_GRANTS: Record<string, Record<string, ChannelResourceGrant>> = {
  [runbooks.id]: {
    [CHANNEL_ID]: { level: "visible", guestWrite: false },
    "staging-channel-q4-outbound": { level: "visible", guestWrite: false },
  },
  [postmortems.id]: {
    [CHANNEL_ID]: { level: "agent_only", guestWrite: false },
  },
  [notes.id]: {
    "staging-channel-dm-grace": { level: "visible", guestWrite: true },
  },
};

export const SEED_STARRED: string[] = [runbooks.id, notes.id];

export const SEED_TEAMS: TeamView[] = [
  {
    id: "team-platform",
    workspaceId: STAGING_HOME_WORKSPACE_ID,
    name: "Platform",
    description: "Infra, deploys and on-call.",
    color: "#2f6fed",
    icon: null,
    createdBy: STAGING_USER_ID,
    createdAt: daysAgoIso(90),
    updatedAt: daysAgoIso(10),
    memberCount: 3,
    memberIds: [STAGING_USER_ID, GRACE.userId, ANTHONY.userId],
    grants: [],
  },
  {
    id: "team-growth",
    workspaceId: STAGING_HOME_WORKSPACE_ID,
    name: "Growth",
    description: null,
    color: "#1f9d55",
    icon: null,
    createdBy: GRACE.userId,
    createdAt: daysAgoIso(60),
    updatedAt: daysAgoIso(12),
    memberCount: 2,
    memberIds: [STAGING_USER_ID, GRACE.userId],
    grants: [],
  },
];

// ─── Folders + entries ───────────────────────────────────────────────

const fDeploys = folder("f-deploys", runbooks, "Deploys", null, 0, "Shipping to prod and back.");
const fOncall = folder("f-oncall", runbooks, "On-call", null, 1, "Paging, escalation, handoff.");
const fDb = folder("f-db", runbooks, "Database", fDeploys.id, 0);
const f2026 = folder("f-pm-2026", postmortems, "2026", null, 0);
const fMeetings = folder("f-meetings", notes, "Meetings", null, 0, "1:1s and standups.");
const fIdeas = folder("f-ideas", notes, "Ideas", null, 1);
const fLoops = folder("f-loops", hiring, "Interview loops", null, 0);
const fMigPlan = folder("f-mig-plan", migration, "Plan", null, 0);

export const SEED_FOLDERS: KnowledgeFolder[] = [
  fDeploys,
  fOncall,
  fDb,
  f2026,
  fMeetings,
  fIdeas,
  fLoops,
  fMigPlan,
];

export const SEED_ENTRIES: KnowledgeEntry[] = [
  entry("e-rollback", runbooks, fDeploys.id, "Rollback", "How and when to roll a deploy back.", ROLLBACK, 0, {
    createdBy: GRACE.userId,
    lastEditedBy: GRACE.userId,
    updatedAt: minsAgoIso(42),
  }),
  entry("e-deploy", runbooks, fDeploys.id, "Production deploy", "The standard path to prod.", DEPLOY, 1, {
    lastEditedSource: "agent",
    updatedAt: daysAgoIso(3),
  }),
  entry("e-migrations", runbooks, fDb.id, "Applying migrations", "Byte-exact, by name, md5-verified.", MIGRATIONS, 0),
  entry("e-escalation", runbooks, fOncall.id, "Escalation", "Severity table and who to page.", ESCALATION, 0),
  entry("e-handoff", runbooks, fOncall.id, "Monday handoff", null, HANDOFF, 1, {
    entryType: "note",
  }),
  entry("e-pm-search", postmortems, f2026.id, "Search outage after 1.37.0", "Empty search results for 38 minutes.", PM_SEARCH, 0),
  entry("e-pm-signout", postmortems, f2026.id, "Desktop sign-out loop", "Stale refresh revoked the token family.", PM_SIGNOUT, 1, {
    lastEditedSource: "agent",
  }),
  entry("e-standup", notes, fMeetings.id, "Standup notes", "Monday standup.", STANDUP, 0, {
    entryType: "note",
    updatedAt: minsAgoIso(15),
  }),
  entry("e-1on1", notes, fMeetings.id, "1:1 — Grace", "Wins, growth, follow-ups.", ONE_ON_ONE, 1),
  entry("e-glasses", notes, fIdeas.id, "Glasses as a channel member", null, IDEA_GLASSES, 0),
  entry("e-inbox", notes, null, "Inbox", "Loose notes to file later.", "## Today\n\n- Reply to the design review thread\n- Book the offsite room\n", 0, {
    entryType: "note",
  }),
  entry("e-role", hiring, null, "Platform engineer — role brief", "What we're hiring for.", ROLE_BRIEF, 0),
  entry("e-onsite", hiring, fLoops.id, "Onsite loop", "Three interviews plus scorecard.", LOOP_ONSITE, 0),
  entry("e-reading", reading, null, "Books", null, READING, 0),
  entry("e-mig-plan", migration, fMigPlan.id, "Cutover plan", "Three phases, one window.", MIG_PLAN, 0),
];

// ─── Revisions (the base Changelog) ──────────────────────────────────

let revSeq = 0;
function rev(
  e: KnowledgeEntry,
  op: Revision["op"],
  minutesAgo: number,
  who: { userId: string; displayName?: string | null; avatarUrl?: string | null },
  kind: "user" | "agent" = "user",
  summary: string | null = null
): Revision {
  const at = minsAgoIso(minutesAgo);
  revSeq += 1;
  return {
    id: `rev-seed-${revSeq}`,
    resourceType: "knowledge_entry",
    resourceId: e.id,
    workspaceId: e.workspaceId,
    actor: {
      userId: who.userId,
      kind,
      agentSessionId: kind === "agent" ? "staging-session-1" : null,
      displayName: who.displayName ?? null,
      avatarUrl: who.avatarUrl ?? null,
    },
    op,
    summary,
    payload: { body: e.body, title: e.title, path: e.title },
    contentHash: `hash-${revSeq}`,
    createdAt: at,
    updatedAt: at,
  };
}

const byId = (id: string) => SEED_ENTRIES.find((e) => e.id === id)!;
const DANIEL = STAGING_PEOPLE[0];

export const SEED_REVISIONS: Revision[] = [
  rev(byId("e-rollback"), "edit", 42, GRACE),
  rev(byId("e-deploy"), "section_edit", 60 * 26, DANIEL, "agent", "Updated the canary step"),
  rev(byId("e-rollback"), "create", 60 * 24 * 3, GRACE),
  rev(byId("e-escalation"), "rename", 60 * 24 * 4, DANIEL),
  rev(byId("e-pm-search"), "create", 60 * 24 * 6, DANIEL),
  rev(byId("e-pm-signout"), "edit", 60 * 24 * 7, DANIEL, "agent"),
  rev(byId("e-standup"), "edit", 15, DANIEL),
  rev(byId("e-1on1"), "create", 60 * 24 * 2, DANIEL),
  rev(byId("e-glasses"), "move", 60 * 24 * 5, DANIEL),
  rev(byId("e-role"), "edit", 60 * 24 * 8, DANIEL),
  rev(byId("e-onsite"), "restore", 60 * 24 * 9, DANIEL, "user", "Restored the version from 13 Oct"),
  rev(byId("e-mig-plan"), "create", 60 * 24 * 11, DANIEL),
];
