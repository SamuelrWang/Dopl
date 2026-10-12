/**
 * The banner demo's scripted, hand-authored channel data in real product shapes, so
 * the record pane renders the product's own channels components. The mock /home rows
 * live in `demo-home-rows.ts`: the Next tree cannot import `apps/desktop-ui/`.
 */

import { EMPTY_INFO_CARD } from "@/features/channels/info-card";
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
} from "@/features/channels/types";
import type { ChannelPeerSession } from "@/features/channels/hooks/use-channel-agent-sessions";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { AgentRosterEntry } from "@/features/channels/components/view-model";
import type { AgentColorKey } from "@dopl/contracts";
import { pickAgentColor } from "@/features/channels/lib/agent-color-pick";
import {
  MENTIONS_METADATA_KEY,
  resolveMentions,
} from "@/features/channels/lib/mentions";
import { reached, type StepId } from "./demo-steps";

export const WORKSPACE_ID = "demo-workspace";
export const CHANNEL_ID = "demo-ch-sales";
export const CURRENT_USER_ID = "demo-u-samuel";

/** One member per photo in `public/img/avatars/`; a member without one renders as initials. */
const U = {
  samuel: CURRENT_USER_ID,
  grace: "demo-u-grace",
  anthony: "demo-u-anthony",
};

/** `public/` paths, which `useBridgedImageSrc` returns verbatim on the web. */
export const FACE = {
  [U.samuel]: "/img/avatars/sam.jpg",
  [U.grace]: "/img/avatars/grace.jpg",
  [U.anthony]: "/img/avatars/anthony.jpg",
} as const;

/** One clock per load; the other demo modules stamp off it so no time drifts. */
const NOW = Date.now();
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
    myFavoritedAt: null,
    agentOnline: true,
    lastSeenAt: minsAgo(0),
    addedBy: null,
    joinedAt: minsAgo(60 * 24 * 12),
    displayName,
    email,
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
    // The row extras are one projection, so the fixture carries them too.
    container: { id: "ws-1", kind: "standard", segment: "ws-1-aaaaaa" },
    myWorkspaceRole: "owner",
    peers: [],
    mentionCount: 0,
    linkOut: null,
    infoCard: EMPTY_INFO_CARD,
    ...extra,
  };
}

/** The scene's one channel; `topic` is the Description row of the product's own info tab. */
export const SALES_CHANNEL = channel(CHANNEL_ID, "q4-outbound", {
  topic: "Q4 outbound push — enrichment, sequences, segments.",
});

/* ── Agents — identities as roles, one per member ──────────────────── */

/** 8-char instance ids, `^[a-z][a-z0-9]{7}$` like the desktop mints. */
export const AGENT_IDS = {
  enricher: "lenrich1",
  writer: "owriter1",
  analyst: "panalyst",
} as const;

/**
 * ONE COLOUR PER AGENT, AND NOT HAND-PICKED (Samuel, 2026-10-12: every agent gets
 * its own colour, in the real app's palette).
 *
 * ⚠ **IT RUNS THE PRODUCT'S OWN PICKER RATHER THAN NAMING THREE KEYS.**
 * `agent-color-pick.ts › pickAgentColor` is the live assignment policy (most distinct
 * from the colours already out, 2026-10-08), so walking it once per agent in launch
 * order yields exactly what this room would really have been handed. Three literal
 * keys would be a look-alike that drifts the day the policy changes, which is the
 * same rule the rest of this file follows for shapes.
 *
 * ⚠ **IT THROWS ON ABSENCE.** A `null` from the picker means the sixteen keys are out,
 * which cannot happen for three agents — so it is a broken palette, not a demo with
 * grey agents. The scene must fail loudly rather than quietly render the uncoloured
 * state this change exists to remove.
 */
function launchOrderColors(count: number): AgentColorKey[] {
  const taken = new Set<string>();
  const out: AgentColorKey[] = [];
  for (let i = 0; i < count; i += 1) {
    const key = pickAgentColor(taken);
    if (key === null) {
      throw new Error(
        `banner demo: the agent colour bank ran out after ${i} of ${count} agents`
      );
    }
    taken.add(key);
    out.push(key);
  }
  return out;
}

/** Launch order is `launch-1` … `launch-3`: enricher, writer, analyst. */
const [ENRICHER_COLOR, WRITER_COLOR, ANALYST_COLOR] = launchOrderColors(3);

export const AGENT_COLORS = {
  [AGENT_IDS.enricher]: ENRICHER_COLOR,
  [AGENT_IDS.writer]: WRITER_COLOR,
  [AGENT_IDS.analyst]: ANALYST_COLOR,
} as const;

/** Identity names as sales-team roles, fed to `AuthorIndex.agents` for attribution pills. */
export const AGENT_INDEX: ReadonlyMap<string, AgentRosterEntry> = new Map([
  [
    AGENT_IDS.enricher,
    {
      displayName: "Lead Enricher",
      description: "Cleans and enriches lead lists",
      color: ENRICHER_COLOR,
    },
  ],
  [
    AGENT_IDS.writer,
    {
      displayName: "Outreach Writer",
      description: "Drafts and personalizes sequences",
      color: WRITER_COLOR,
    },
  ],
  [
    AGENT_IDS.analyst,
    {
      displayName: "Pipeline Analyst",
      description: "Segments and scores the pipeline",
      color: ANALYST_COLOR,
    },
  ],
]);

/** Samuel's own live agent — the desktop feed the Agents tab and panel read. */
export const MY_SESSION: DesktopSessionSummary = {
  sessionId: "demo-session-writer",
  channelId: CHANNEL_ID,
  // `""` is the channel (`agents-model.ts › postDestination`): "Posted to channel".
  taskId: "",
  agentId: AGENT_IDS.writer,
  name: AGENT_IDS.writer,
  displayName: "Outreach Writer",
  state: "working",
  channelName: "q4-outbound",
  threadTitle: null,
  identityName: "Outreach Writer",
  contextUsed: 38_000,
  contextWindow: 200_000,
  tokensSpent: 92_400,
  startedAt: NOW - 3 * 60_000,
  lastActivityAt: NOW - 20_000,
};

/**
 * ⚠ **`displayName` AND `color` ARE BOTH REQUIRED FOR A PEER PILL TO BE HONEST**
 * (2026-10-12). Both are optional on `ChannelSessionState` and this fixture set
 * NEITHER, which cost two things: `displayName` absent falls the pill back to
 * `#<name>` and `name` here is the 8-char agent INSTANCE ID, so the scene printed
 * `#lenrich1` at a reader — the one thing an agent surface may never show
 * (`agent-id-visibility.test.ts`) — and `color` absent drew the neutral box, so a
 * peer's agent looked uncoloured beside its own coloured posts in the transcript.
 * Both fields are peer-visible by design (`types-sessions.ts`), so a real room has
 * them.
 */
function peer(
  userId: string,
  agentId: string,
): ChannelPeerSession {
  const identity = AGENT_INDEX.get(agentId);
  if (!identity) {
    throw new Error(`banner demo: no agent identity for ${agentId}`);
  }
  return {
    channelId: CHANNEL_ID,
    threadId: null,
    name: agentId,
    displayName: identity.displayName,
    color: AGENT_COLORS[agentId as keyof typeof AGENT_COLORS],
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

/**
 * **THE MENTION SET, RESOLVED THE WAY THE SERVER RESOLVES IT** (Samuel, 2026-10-12:
 * messages must render mention pills).
 *
 * ⚠ **DERIVED FROM THE BODY, NEVER AUTHORED BESIDE IT.** `metadata` was `{}` on every
 * message in this scene, and `mentionsMe` is read off `metadata.mentionedUserIds`
 * (`view-model-rows.ts › channelRows`) — so no `@name` in any body could ever tint, be
 * counted, or reach the mentions inbox. Running `lib/mentions.ts › resolveMentions`,
 * which is the SAME function the server's write path uses
 * (`service-writes-metadata.ts › resolvePostMetadata`), means a tag typed into a body
 * resolves here exactly as it would in the product. That is what keeps the copy a
 * DATA change: write `@Grace` in a line and the pill, the highlight and the inbox row
 * follow with no code edit.
 *
 * ⚠ **THE AUTHOR IS EXCLUDED**, per that key's own contract ("author excluded"), so a
 * member tagging themselves does not light their own inbox.
 *
 * ⚠ **THE KEY IS STAMPED ONLY WHEN THE SET IS NON-EMPTY**, also per contract: absent
 * means "tags nobody", and an empty array would be a shape no stored row has.
 */
export function mentionMetadata(
  body: string,
  authorUserId: string | null,
): Record<string, unknown> {
  const ids = resolveMentions(body, MEMBERS).filter(
    (id) => id !== authorUserId,
  );
  return ids.length > 0 ? { [MENTIONS_METADATA_KEY]: ids } : {};
}

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
      metadata: mentionMetadata(body, authorUserId),
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
 * Every post is channel-level: a `taskId` would make `view-model-rows.ts › channelRows`
 * collapse the conversation into a thread card. Threads reading `0` is intended.
 */
const agentPost = (agentId: string, n: number) => ({
  authorKind: "agent" as const,
  clientMsgId: `agent-${agentId}-${n}`,
});

/** The scene's messages in seq order, each tagged with the step it lands on. */
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
  // The kickoff: an ordinary channel post, not a thread opener.
  msg(
    "channel-request",
    U.grace,
    "Kicking off Q4 outbound — enrich the list, draft the sequences, cut the segment. Everyone bring your agent.",
    4,
  ),
  // Launch lines, one per member.
  msg("launch-1", null, "Grace launched Lead Enricher from an identity", 3, {
    kind: "system",
    authorKind: "system",
  }),
  msg("launch-2", null, "Samuel launched Outreach Writer from an identity", 3, {
    kind: "system",
    authorKind: "system",
  }),
  msg("launch-3", null, "Anthony launched Pipeline Analyst from an identity", 3, {
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
  // ⚠ ON `agent-post-2`, THE LAST BEAT, NOT HERE WITH THE OTHER POSTS. Its stamp was
  // always right (`minsAgo(0)` is the newest thing in the scene, so the stream sorted it
  // last); what was wrong is that `messagesAt` REVEALED it ten beats before the agent
  // view opened. See `demo-steps.ts › agent-post-2`.
  msg(
    "agent-post-2",
    U.samuel,
    "Variant A personalized for all 74 — queued for Grace's review.",
    0,
    agentPost(AGENT_IDS.writer, 2),
  ),
];

export function messagesAt(step: number): ChannelMessage[] {
  return SCRIPT.filter((s) => reached(step, s.step)).map((s) => s.message);
}

/**
 * **ONE SCRIPTED POST, WITH THE BEAT IT LANDS ON** — for the fixtures that must point AT
 * a message rather than restate it (`demo-info-data.ts`'s mentions inbox).
 *
 * ⚠ **IT THROWS ON A MISS, AND THAT IS THE WHOLE POINT.** The mentions rows hand-authored
 * their own `seq`, `authorUserId`, `authorName` and `createdAt`, and two of the three had
 * DRIFTED off the messages they cite: the row quoting the analyst's line was keyed to
 * `demo-m9`, which is the writer's post, and the row quoting Anthony's CRM line was
 * attributed to Grace. Nothing rendered wrong because the list prints its own copy of
 * those fields, which is exactly how a fixture rots unnoticed. Deriving them from the
 * script means a renumbered or reworded post fails HERE instead.
 */
function scripted(id: string): { step: StepId; message: ChannelMessage } {
  const found = SCRIPT.find((s) => s.message.id === id);
  if (!found) {
    throw new Error(`banner demo: no scripted message ${id}`);
  }
  return found;
}

/** The post a fixture cites, and the beat it arrives on, so the two reveal together. */
export function citedMessage(id: string): {
  step: StepId;
  message: ChannelMessage;
  /** The authoring agent's colour, or `null` for a post a member wrote themselves. */
  agentColor: AgentColorKey | null;
  /** The authoring agent's id, read off `clientMsgId` as `agentPost` stamps it. */
  agentId: string | null;
} {
  const { step, message } = scripted(id);
  const agentId =
    message.authorKind === "agent" && message.clientMsgId
      ? (message.clientMsgId.split("-")[1] ?? null)
      : null;
  return {
    step,
    message,
    agentId,
    agentColor:
      agentId === null
        ? null
        : (AGENT_COLORS[agentId as keyof typeof AGENT_COLORS] ?? null),
  };
}

