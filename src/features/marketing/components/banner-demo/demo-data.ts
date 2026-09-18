/**
 * The banner demo's SCRIPTED ACCOUNT SURFACE — real channels data shapes,
 * hand authored, revealed step by step.
 *
 * ⚠ NOTHING IN HERE IS A UI COMPONENT. The demo's RECORD PANE renders the
 * PRODUCT's own channels components (`banner-demo.tsx`); this file only
 * builds the `Channel` / `ChannelMember` / `ChannelMessage` / session rows
 * those components are fed everywhere else, so the pane cannot drift from the
 * real surface's face.
 *
 * ⚠ THE SCENE IS /home SINCE 2026-08-30 (Samuel), and the MOCK half of its data
 * is deliberately NOT here — it is `demo-home-rows.ts`. /home's chrome (account
 * rail, gray panel, header selector, 290px channel list) lives in
 * `apps/desktop-ui/src/pages/home/`, a SEPARATE app the Next tree cannot import
 * (root `tsconfig.json` excludes `apps`, and those files resolve `#/*` against
 * the SPA's own src), so that chrome is hand-built marketing markup
 * (`demo-home-chrome.tsx`) over hand-authored rows. Keeping those rows in
 * their own file is what lets THIS file stay all-product-shapes. The RECORD
 * PANE inside the chrome is the product's own surface, exactly as it is on the
 * real page (`relationship-record.tsx`).
 */

import { EMPTY_INFO_CARD } from "@/features/channels/info-card";
// ⚠ `EMPTY_AGENT_POSTURE` no longer imported (2026-09-06): `Channel.agentPosture` is
// deleted with the channel ceiling (items 12, 13, 14).
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
} from "@/features/channels/types";
import type { ChannelPeerSession } from "@/features/channels/hooks/use-channel-agent-sessions";
import type {
  DesktopNarrationEntry,
  DesktopSessionSummary,
} from "@/shared/lib/spa-bridge";
import type { AgentIdentity } from "@/features/channels/components/view-model";
import { reached, type StepId } from "./demo-steps";

export const WORKSPACE_ID = "demo-workspace";
export const CHANNEL_ID = "demo-ch-sales";
export const CURRENT_USER_ID = "demo-u-samuel";

/**
 * 🔒 **THE CAST IS EXACTLY AS LARGE AS THE PHOTOGRAPHS WE SHIP (Samuel,
 * 2026-09-17, over the rejected scene):** *"use bundled placeholder avatar
 * images for the fictional people; initials chips are not the product's face."*
 * Three faces, three files in `public/img/avatars/`. **Do not add a fourth
 * person without a fourth photo** — a nameless member degrades to initials, and
 * an `AvatarStack` over four of them degrades to `+N`, which is the exact
 * artefact he pointed at.
 */
const U = {
  samuel: CURRENT_USER_ID,
  grace: "demo-u-grace",
  anthony: "demo-u-anthony",
};

/** The bundled photograph for each of the three. ⚠ A `public/` path, which
 *  `useBridgedImageSrc` returns verbatim on the web — no bridge, no request
 *  beyond the asset. */
export const FACE = {
  [U.samuel]: "/img/avatars/sam.jpg",
  [U.grace]: "/img/avatars/grace.jpg",
  [U.anthony]: "/img/avatars/anthony.jpg",
} as const;

/** Anchored once per load so relative stamps ("2m ago") stay plausible.
 *  ⚠ EXPORTED so `demo-home-rows.ts` stamps its rows off the SAME anchor — a
 *  second `Date.now()` there would drift the list's timestamps off the
 *  transcript's by however long the module graph took to evaluate. */
const NOW = Date.now();
/** ⚠ THE SAME ANCHOR, FOR THE MODULES THAT NEED EPOCH MS RATHER THAN AN ISO
 *  STRING (`demo-info-data.ts`'s day keys). One clock, two presenters. */
export const NOW_MS = NOW;
export const minsAgo = (m: number) =>
  new Date(NOW - m * 60_000).toISOString();

/* ── Roster ───────────────────────────────────────────────────────── */

function member(
  userId: string,
  displayName: string,
  email: string,
  owner = false,
): ChannelMember {
  return {
    channelId: CHANNEL_ID,
    userId,
    role: owner ? "owner" : "member",
    workspaceRole: null,
    lastReadAt: minsAgo(1),
    notifyScope: null,
    agentToolProfile: null,
    favoritedAt: null,
    agentOnline: true,
    lastSeenAt: minsAgo(0),
    addedBy: null,
    joinedAt: minsAgo(60 * 24 * 12),
    displayName,
    email,
    // ⚠ EVERY MEMBER HAS A PHOTOGRAPH — see `U`'s docblock.
    avatarUrl: FACE[userId as keyof typeof FACE] ?? null,
  };
}

export const MEMBERS: ChannelMember[] = [
  member(U.samuel, "Samuel Wang", "srwang@usc.edu", true),
  member(U.grace, "Grace Okafor", "grace@vermillion.io"),
  member(U.anthony, "Anthony Reyes", "anthony@lattice.build"),
];

/* ── Channels (sidebar) ───────────────────────────────────────────── */

function channel(
  id: string,
  name: string,
  extra: Partial<Channel> = {},
): Channel {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    slug: name,
    name,
    topic: "",
    visibility: "private",
    isDirect: false,
    directPeer: null,
    createdBy: U.samuel,
    archivedAt: null,
    createdAt: minsAgo(60 * 24 * 12),
    updatedAt: minsAgo(2),
    memberCount: 3,
    lastMessageAt: minsAgo(2),
    role: "owner",
    isMember: true,
    lastReadAt: minsAgo(1),
    unread: false,
    myNotifyScope: null,
    myAgentToolProfile: null,
    myFavoritedAt: null,
    onlineMemberCount: 3,
    infoCard: EMPTY_INFO_CARD,
    // ⚠ `defaultResponderAgentName` LEFT THIS FIXTURE ON 2026-09-07 with the field (items 10
    // and 11), as `agentPosture` did the day before.
    ...extra,
  };
}

/**
 * The one channel the scene plays.
 *
 * ⚠ `ROOMS` / `DIRECT` STOOD HERE AND ARE DELETED (2026-08-30). They fed
 * `ChannelsSidebar` — the WORKSPACE channel tree — which the /home scene does
 * not have: the account surface's left column is one flat channel list with no
 * sections, and it is `HOME_ROWS` at the foot of this file. Do not re-add a
 * rooms/DMs split here; it is the shape Samuel rejected.
 */
/**
 * ⚠ **THE `topic` IS THE SCENE'S Description ROW (wave 1A, 2026-09-17).** It was
 * a string passed straight into a scripted Info tab; that tab is deleted and the
 * hero now mounts the PRODUCT's `info-tab.tsx › InfoTab`, which reads the column
 * every real channel reads. A fact about the channel belongs on the channel row.
 */
export const SALES_CHANNEL = channel(CHANNEL_ID, "q4-outbound", {
  topic: "Q4 outbound push — enrichment, sequences, segments.",
});

/* ── The thread ───────────────────────────────────────────────────── */

/**
 * 🔒 **THE THREAD FIXTURE IS DELETED (Samuel, 2026-09-17):** *"Render THAT
 * composition … No thread view."* The scene opened `Q4 Outbound Push`, which put
 * a BREADCRUMB in the pane header, replaced the info column's four tabs with the
 * thread's three, and made the composer address the thread — the WORKSPACE shape
 * on the surface that is supposed to be /home's channel record.
 *
 * ⚠ **`THREAD_ID` GOES WITH IT.** Nothing in this scene carries a `taskId` now,
 * which is what keeps `channelRows` from collapsing the conversation into a
 * card (see `agentPost` below). **Do not reintroduce either to "show threads"** —
 * the Threads tab reading `0` is the ruling, not a gap.
 */

/* ── Agents — templates as roles, one per member ──────────────────── */

/** 8-char instance ids, `^[a-z][a-z0-9]{7}$` like the desktop mints. */
export const AGENT_IDS = {
  enricher: "lenrich1",
  writer: "owriter1",
  analyst: "panalyst",
} as const;

/** The template names read as ROLES on a sales team. Fed into
 *  `AuthorIndex.agents` so the transcript's attribution pills name them. */
export const AGENT_INDEX: ReadonlyMap<string, AgentIdentity> = new Map([
  [
    AGENT_IDS.enricher,
    { displayName: "Lead Enricher", description: "Cleans and enriches lead lists" },
  ],
  [
    AGENT_IDS.writer,
    { displayName: "Outreach Writer", description: "Drafts and personalizes sequences" },
  ],
  [
    AGENT_IDS.analyst,
    { displayName: "Pipeline Analyst", description: "Segments and scores the pipeline" },
  ],
]);

/** MY live agent (Samuel's) — the desktop feed the Agents tab + panel read. */
export const MY_SESSION: DesktopSessionSummary = {
  sessionId: "demo-session-writer",
  channelId: CHANNEL_ID,
  // ⚠ `""` IS THE CHANNEL (`agents-model.ts › postDestination`) — the scene has
  // no thread since 2026-09-17, so the sent banner reads "Posted to channel".
  taskId: "",
  agentId: AGENT_IDS.writer,
  name: AGENT_IDS.writer,
  displayName: "Outreach Writer",
  state: "working",
  channelName: "q4-outbound",
  threadTitle: null,
  templateName: "Outreach Writer",
  contextUsed: 38_000,
  contextWindow: 200_000,
  tokensSpent: 92_400,
  startedAt: NOW - 3 * 60_000,
  lastActivityAt: NOW - 20_000,
};

function peer(
  userId: string,
  name: string,
): ChannelPeerSession {
  return {
    channelId: CHANNEL_ID,
    threadId: null,
    name,
    state: "working",
    channelName: "q4-outbound",
    threadTitle: null,
    updatedAt: minsAgo(0),
    userId,
  };
}

export const PEER_ENRICHER = peer(U.grace, AGENT_IDS.enricher);
export const PEER_ANALYST = peer(U.anthony, AGENT_IDS.analyst);

/* ── The transcript, revealed step by step ────────────────────────── */

let seq = 0;
function msg(
  step: StepId,
  authorUserId: string | null,
  body: string,
  minutesAgo: number,
  extra: Partial<ChannelMessage> = {},
): { step: StepId; message: ChannelMessage } {
  seq += 1;
  return {
    step,
    message: {
      id: `demo-m${seq}`,
      seq,
      channelId: CHANNEL_ID,
      authorUserId,
      authorKind: "user",
      kind: "message",
      body,
      metadata: {},
      clientMsgId: null,
      createdAt: minsAgo(minutesAgo),
      authorName:
        MEMBERS.find((m) => m.userId === authorUserId)?.displayName ?? null,
      authorAvatarUrl: null,
      ...extra,
    },
  };
}

/**
 * 🔒 **EVERY POST IS CHANNEL-LEVEL (Samuel, 2026-09-17):** *"Render THAT
 * composition … No thread view."* The scene used to open a THREAD, so the pane
 * wore a breadcrumb and the column wore the thread's tabs — the workspace
 * shape, not /home's channel record.
 *
 * ⚠ **A `taskId` IS WHAT MADE IT ONE, SO THERE ARE NONE.** `view-model-rows.ts ›
 * channelRows` COLLAPSES every threaded post into a single thread CARD, so a
 * channel view over a threaded script would have shown three lines and a card
 * instead of the conversation. ⚠ `postDestination` reads `taskId === ""` as the
 * channel, which is what makes the agent's sent banner say "Posted to channel".
 */
const agentPost = (agentId: string, n: number) => ({
  authorKind: "agent" as const,
  clientMsgId: `agent-${agentId}-${n}`,
});

/**
 * Every message of the scene, in seq order, each tagged with the step it
 * lands on. `messagesAt(step)` slices the prefix the current beat has earned.
 */
const SCRIPT: ReadonlyArray<{ step: StepId; message: ChannelMessage }> = [
  // Channel view.
  msg(
    "channel-base",
    U.grace,
    "Fresh list from the conference just landed — 240 leads.",
    26,
  ),
  msg(
    "channel-base",
    U.anthony,
    "Half of them are missing titles in the CRM again.",
    24,
  ),
  msg(
    "channel-samuel",
    U.samuel,
    "Big quarter push starts today — let's line up outbound.",
    5,
  ),
  // The request that sets the room going — an ordinary channel post since
  // 2026-09-17 (it was a thread OPENER, and the card it drew is what put this
  // pane on the workspace's thread shape).
  msg(
    "channel-request",
    U.grace,
    "Kicking off Q4 outbound — enrich the list, draft the sequences, cut the segment. Everyone bring your agent.",
    4,
  ),
  // Launch lines — the thread narrating itself, one per member.
  msg("launch-1", null, "Grace launched Lead Enricher from a template", 3, {
    kind: "system",
    authorKind: "system",
  }),
  msg("launch-2", null, "Samuel launched Outreach Writer from a template", 3, {
    kind: "system",
    authorKind: "system",
  }),
  msg("launch-3", null, "Anthony launched Pipeline Analyst from a template", 3, {
    kind: "system",
    authorKind: "system",
  }),
  // The agents collaborate — each posts under its operator's account, stamped.
  msg(
    "agent-msg-1",
    U.grace,
    "Pulled the 240 conference leads — 186 have verified emails. Tagging seniority and industry now.",
    2,
    agentPost(AGENT_IDS.enricher, 1),
  ),
  msg(
    "agent-msg-2",
    U.samuel,
    "Drafting three sequence variants off the enriched list. Pipeline Analyst — which segment converts best?",
    2,
    agentPost(AGENT_IDS.writer, 1),
  ),
  msg(
    "agent-msg-3",
    U.anthony,
    "Director+ at 50–500 headcount closed 3× faster last quarter. That's 74 of the 186.",
    1,
    agentPost(AGENT_IDS.analyst, 1),
  ),
  msg(
    "agent-msg-4",
    U.grace,
    "Segment tagged Q4-A and synced to the CRM.",
    1,
    agentPost(AGENT_IDS.enricher, 2),
  ),
  msg(
    "agent-msg-5",
    U.samuel,
    "Variant A personalized for all 74 — queued for Grace's review.",
    0,
    agentPost(AGENT_IDS.writer, 2),
  ),
];

export function messagesAt(step: number): ChannelMessage[] {
  return SCRIPT.filter((s) => reached(step, s.step)).map((s) => s.message);
}

/* ── The 1:1 lane — Samuel steering his own agent ─────────────────── */

const dm = (
  step: StepId,
  lane: "operator" | "private",
  text: string,
  secondsAgo: number,
): { step: StepId; entry: DesktopNarrationEntry } => ({
  step,
  entry: {
    at: NOW - secondsAgo * 1000,
    kind: lane,
    lane,
    text,
  } as DesktopNarrationEntry,
});

const DM_SCRIPT: ReadonlyArray<{ step: StepId; entry: DesktopNarrationEntry }> =
  [
    dm(
      "dm-user-1",
      "operator",
      "Keep variant A casual — and mention the SOC 2 launch up top.",
      40,
    ),
    dm(
      "dm-agent-1",
      "private",
      "Done — reworked the opener around SOC 2, kept it under 90 words. Want a CTO-specific version too?",
      25,
    ),
    dm("dm-user-2", "operator", "Yes. Same angle, more technical.", 12),
    dm(
      "dm-agent-2",
      "private",
      "On it. Two drafts landing in the thread in a minute.",
      4,
    ),
  ];

export function narrationAt(step: number): DesktopNarrationEntry[] {
  return DM_SCRIPT.filter((s) => reached(step, s.step)).map((s) => s.entry);
}

