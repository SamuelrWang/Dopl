/**
 * The banner demo's scripted, hand-authored channel data in real product shapes, so
 * the record pane renders the product's own channels components. The mock /home rows
 * live in `demo-home-rows.ts`: the Next tree cannot import `apps/desktop-ui/`.
 */

import { EMPTY_INFO_CARD } from "@/features/channels/info-card";
import type {
  Channel,
  ChannelMember,
  ChannelThread,
} from "@/features/channels/types";
import type { ChannelPeerSession } from "@/features/channels/hooks/use-channel-agent-sessions";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { AgentRosterEntry } from "@/features/channels/components/view-model";
import type { AgentColorKey } from "@dopl/contracts";
import { pickAgentColor } from "@/features/channels/lib/agent-color-pick";

export const WORKSPACE_ID = "demo-workspace";
export const CHANNEL_ID = "demo-ch-debt";
export const CURRENT_USER_ID = "demo-u-samuel";

/** One member per photo in `public/img/avatars/`; a member without one renders as initials. */
export const U = {
  samuel: CURRENT_USER_ID,
  grace: "demo-u-grace",
  anthony: "demo-u-anthony",
};

/** `public/` paths, which `useBridgedImageSrc` returns verbatim on the web. */
export const FACE = {
  [U.samuel]: "/img/avatars/daniel.jpg",
  [U.grace]: "/img/avatars/grace-v2.jpg",
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
  member(U.samuel, "Daniel Ortiz", "daniel@vermillion.io", true),
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

/** Spelled once: it rides the channel, every session row and the pane's own header. */
export const CHANNEL_NAME = "tech-debt";

/** The scene's one channel; `topic` is the Description row of the product's own info tab. */
export const DEMO_CHANNEL = channel(CHANNEL_ID, CHANNEL_NAME, {
  topic: "Paying down the debt that keeps biting us.",
});

/* ── Threads ───────────────────────────────────────────────────────── */

/**
 * **ONE THREAD PER ORCHESTRATOR** (v3, Samuel 2026-10-12).
 *
 * ⚠ **A THREAD IS JOINED TO ITS MESSAGES BY `metadata.taskId`, NOTHING ELSE**
 * (`view-model.ts › threadIdOf`). `channelRows` then collapses every tagged message
 * into ONE `thread-card` for the opener and suppresses the rest
 * (`view-model-rows.ts › channelRows`), and `threadRows` filters the same array back
 * out for the thread view. So the channel list, the card and the thread transcript are
 * three projections of one message array, which is why nothing here duplicates a body.
 *
 * ⚠ `status` is LEGACY AND UNREAD (its own type comment says so, "four columns, one
 * story"), so these carry the ordinary open shape rather than inventing a state.
 */
function thread(
  id: string,
  title: string,
  createdBy: string,
  minutesAgo: number,
): ChannelThread {
  return {
    id,
    channelId: CHANNEL_ID,
    workspaceId: WORKSPACE_ID,
    title,
    status: "open",
    outcome: null,
    mode: "interactive",
    createdBy,
    // The opener's own thread: both parties may write (INVARIANTS §5), and
    // `ownThreadOf` picks it for "Open thread" when the viewer is either one.
    targetUserId: null,
    createdAt: minsAgo(minutesAgo),
    updatedAt: minsAgo(minutesAgo),
    closedAt: null,
    outcomeSummary: null,
    lastActivityAt: minsAgo(minutesAgo),
  };
}

export const THREAD_IDS = {
  flakes: "demo-th-flakes",
  teardown: "demo-th-teardown",
  uploads: "demo-th-uploads",
} as const;

/** The thread the cursor enters: the viewer's own, opened by his orchestrator. */
export const OPEN_THREAD_ID = THREAD_IDS.teardown;

export const THREADS: ChannelThread[] = [
  thread(THREAD_IDS.flakes, "Flaky test suite", U.grace, 3),
  thread(THREAD_IDS.teardown, "Session teardown leaks", U.samuel, 3),
  thread(THREAD_IDS.uploads, "Upload retry path", U.anthony, 2),
];

export const OPEN_THREAD: ChannelThread = (() => {
  const found = THREADS.find((t) => t.id === OPEN_THREAD_ID);
  if (!found) throw new Error(`banner demo: no thread ${OPEN_THREAD_ID}`);
  return found;
})();

/* ── Agents — identities as roles, one per member ──────────────────── */

/**
 * 8-char instance ids, `^[a-z][a-z0-9]{7}$` like the desktop mints.
 *
 * ⚠ **THE NAMES ARE JOB-NAMED AND INVENTED, NOT OURS** (v3 sanitisation, 2026-10-12).
 * This scene ships on a PUBLIC marketing page, so no real internal agent, path or
 * defect may appear in it. The naming STYLE is ours (short Title Case, named for the
 * job); the jobs belong to a made-up product.
 */
export const AGENT_IDS = {
  // Orchestrators, one per member, in launch order.
  triage: "dtriage1",
  planner: "cplanne1",
  scout: "bscout01",
  // Coders, launched by the planner INSIDE its thread, in launch order.
  teardown: "tdorder1",
  notice: "endchk01",
  wake: "wreplay1",
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

/**
 * Launch order across the whole scene: the three orchestrators on `launch-1`…`launch-3`,
 * then the three coders on `thread-launch-1`…`thread-launch-3`. Six agents, six keys from
 * one walk, so the colours are spread the way a real room's would be.
 */
const [
  TRIAGE_COLOR,
  PLANNER_COLOR,
  SCOUT_COLOR,
  TEARDOWN_COLOR,
  NOTICE_COLOR,
  WAKE_COLOR,
  PRIOR_COLOR,
] = launchOrderColors(7);

/** The older, off-script agent behind the inbox's prior mention (`demo-info-data.ts`). */
export const PRIOR_AGENT_COLOR = PRIOR_COLOR;

export const AGENT_COLORS = {
  [AGENT_IDS.triage]: TRIAGE_COLOR,
  [AGENT_IDS.planner]: PLANNER_COLOR,
  [AGENT_IDS.scout]: SCOUT_COLOR,
  [AGENT_IDS.teardown]: TEARDOWN_COLOR,
  [AGENT_IDS.notice]: NOTICE_COLOR,
  [AGENT_IDS.wake]: WAKE_COLOR,
} as const;

/**
 * Identity names, fed to `AuthorIndex.agents` for attribution pills AND for the agent
 * handle namespace the body renderer tints from
 * (`message-markdown.tsx › bodyContextOf`, via `addressableAgents`). So a name here
 * decides both what a post is attributed to and what `@handle` resolves — which is why
 * the agent-to-agent tags in the script work without any extra wiring.
 */
export const AGENT_INDEX: ReadonlyMap<string, AgentRosterEntry> = new Map([
  [
    AGENT_IDS.triage,
    {
      displayName: "Debt Triage",
      description: "Finds what is hurting and who should take it",
      color: TRIAGE_COLOR,
    },
  ],
  [
    AGENT_IDS.planner,
    {
      displayName: "Cleanup Planner",
      description: "Splits a cleanup into work and briefs it out",
      color: PLANNER_COLOR,
    },
  ],
  [
    AGENT_IDS.scout,
    {
      displayName: "Backlog Scout",
      description: "Reads the backlog for what is already planned",
      color: SCOUT_COLOR,
    },
  ],
  [
    AGENT_IDS.teardown,
    {
      displayName: "Teardown Order Fix",
      description: "Chases a post lost on shutdown",
      color: TEARDOWN_COLOR,
    },
  ],
  [
    AGENT_IDS.notice,
    {
      displayName: "End Notice Check",
      description: "Checks what a closing record actually saved",
      color: NOTICE_COLOR,
    },
  ],
  [
    AGENT_IDS.wake,
    {
      displayName: "Wake Replay Trace",
      description: "Traces a replayed message after a resume",
      color: WAKE_COLOR,
    },
  ],
]);

/**
 * Samuel's own live agents — the desktop feed the Agents tab and the panel read.
 *
 * ⚠ **`taskId` IS WHERE A SESSION POSTS, AND IT DECIDES THE SENT BOX'S CAPTION**
 * (`agents-model.ts › postDestination`): `""` is the channel ("Posted to channel"), a
 * thread id names the thread. The planner works the channel; its three coders work
 * inside the thread it opened, so only they carry one.
 */
function ownSession(
  agentId: string,
  taskId: string,
  startedMinsAgo: number,
  contextUsed: number,
): DesktopSessionSummary {
  const identity = AGENT_INDEX.get(agentId);
  if (!identity?.displayName) {
    throw new Error(`banner demo: no agent identity for ${agentId}`);
  }
  const openThread = taskId === "" ? null : OPEN_THREAD.title;
  return {
    sessionId: `demo-session-${agentId}`,
    channelId: CHANNEL_ID,
    taskId,
    agentId,
    name: agentId,
    displayName: identity.displayName,
    state: "working",
    channelName: CHANNEL_NAME,
    threadTitle: openThread,
    identityName: identity.displayName,
    contextUsed,
    contextWindow: 200_000,
    tokensSpent: Math.round(contextUsed * 2.4),
    startedAt: NOW - startedMinsAgo * 60_000,
    lastActivityAt: NOW - 20_000,
  };
}

/**
 * ⚠ **ORDER IS LAUNCH ORDER, AND THE CURSOR DEPENDS ON IT.** The scripted cursor finds
 * a control by its visible label and takes the FIRST match in DOM order
 * (`banner-demo.tsx › findButton`), so the agent it opens is whichever "Open" button
 * renders first. Launch order puts Teardown Order Fix at the head of the coders, which
 * is the one the private chat belongs to, so the faithful order and the needed order are
 * the same thing. ⚠ Reordering this silently re-points the cursor; `demo-script.test.ts`
 * pins it.
 */
export const MY_SESSIONS: DesktopSessionSummary[] = [
  ownSession(AGENT_IDS.planner, "", 4, 46_000),
  ownSession(AGENT_IDS.teardown, OPEN_THREAD_ID, 2, 38_000),
  ownSession(AGENT_IDS.notice, OPEN_THREAD_ID, 2, 24_000),
  ownSession(AGENT_IDS.wake, OPEN_THREAD_ID, 2, 19_000),
];

/** The session the cursor opens, and whose private lane the script writes. */
export const MY_SESSION: DesktopSessionSummary = (() => {
  const found = MY_SESSIONS.find((s) => s.agentId === AGENT_IDS.teardown);
  if (!found) throw new Error("banner demo: no session for the opened agent");
  return found;
})();

/**
 * ⚠ **`displayName` AND `color` ARE BOTH REQUIRED FOR A PEER PILL TO BE HONEST**
 * (2026-10-12). Both are optional on `ChannelSessionState` and this fixture set
 * NEITHER, which cost two things: `displayName` absent falls the pill back to
 * `#<name>` and `name` here is the 8-char agent INSTANCE ID, so the scene printed
 * `#dtriage1` at a reader — the one thing an agent surface may never show
 * (`agent-id-visibility.test.ts`) — and `color` absent drew the neutral box, so a
 * peer's agent looked uncoloured beside its own coloured posts in the transcript.
 * Both fields are peer-visible by design (`types-sessions.ts`), so a real room has
 * them.
 */
function peer(
  userId: string,
  agentId: string,
  threadId: string | null = null,
): ChannelPeerSession {
  const identity = AGENT_INDEX.get(agentId);
  if (!identity) {
    throw new Error(`banner demo: no agent identity for ${agentId}`);
  }
  return {
    channelId: CHANNEL_ID,
    threadId,
    name: agentId,
    displayName: identity.displayName,
    color: AGENT_COLORS[agentId as keyof typeof AGENT_COLORS],
    state: "working",
    channelName: CHANNEL_NAME,
    threadTitle: null,
    updatedAt: minsAgo(0),
    userId,
  };
}

/** The other members' orchestrators. Their coders run on their machines, not ours. */
export const PEER_TRIAGE = peer(U.grace, AGENT_IDS.triage);
export const PEER_SCOUT = peer(U.anthony, AGENT_IDS.scout);

/**
 * **THE SERVER'S SESSION PROJECTION, WHICH INCLUDES THE VIEWER'S OWN AGENTS.**
 *
 * 🔴 **AND IT HAS TO, BECAUSE COLOUR LIVES ONLY HERE.** `lib/live-agents.ts ›
 * liveAgentsKey` keeps two maps with OPPOSITE precedence on purpose: a NAME is freshest
 * on the local desktop feed, but *"the local feed's COLOUR does not exist, so for colour
 * the SERVER's projection is the only authority and an own row must never be able to
 * speak about it at all"*. So an own agent that appears only in the desktop feed is
 * CORRECTLY colourless, and the composer's working pill for it renders the black
 * `bg-surface-cta` face.
 *
 * ⚠ The first cut of this fixture listed only the two peers here, which looked right and
 * would have shipped Samuel's three coders as black pills in a scene whose whole point is
 * that every agent has its own colour. The real endpoint answers every session in the
 * channel, so this does too.
 *
 * ⚠ `threadId` is what scopes a row to the thread, which is how the working strip narrows
 * to the coders once the cursor is inside it.
 */
export const SERVER_SESSIONS: ChannelPeerSession[] = [
  PEER_TRIAGE,
  PEER_SCOUT,
  peer(U.samuel, AGENT_IDS.planner),
  peer(U.samuel, AGENT_IDS.teardown, OPEN_THREAD_ID),
  peer(U.samuel, AGENT_IDS.notice, OPEN_THREAD_ID),
  peer(U.samuel, AGENT_IDS.wake, OPEN_THREAD_ID),
];
