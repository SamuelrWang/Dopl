/**
 * STAGING DATA BUILDERS — the landing demo's private fixture builders
 * (`banner-demo/demo-data.ts › member/channel/thread/ownSession/peer`,
 * `demo-transcript.ts › msg`, `demo-info-data.ts › mention`), copied with the channel id as a
 * parameter so every channel in the column gets real product shapes. Same clock as the demo
 * (`demo-data.ts › minsAgo` / `NOW_MS`), so stamps agree with the tech-debt transcript.
 */

import { EMPTY_INFO_CARD } from "@/features/channels/info-card";
import type {
  Channel,
  ChannelMember,
  ChannelMention,
  ChannelMessage,
  ChannelThread,
} from "@/features/channels/types";
import type { ChannelPeerSession } from "@/features/channels/hooks/use-channel-agent-sessions";
import type {
  DesktopNarrationEntry,
  DesktopSessionSummary,
} from "@/shared/lib/spa-bridge";
import type { ActivityBin } from "@/features/channels/components/thread-activity";
import {
  FACE,
  MEMBERS as DEMO_MEMBERS,
  NOW_MS,
  U,
  WORKSPACE_ID,
  minsAgo,
} from "@/features/marketing/components/banner-demo/demo-data";
import { mentionMetadata } from "@/features/marketing/components/banner-demo/demo-transcript";
import { stagingAgentIndex } from "./staging-agents";

export { U, minsAgo, NOW_MS, WORKSPACE_ID };

/** The demo's three people, re-addressed to `channelId`. */
export function membersOf(channelId: string, userIds: readonly string[]): ChannelMember[] {
  return DEMO_MEMBERS.filter((m) => userIds.includes(m.userId)).map((m) => ({
    ...m,
    channelId,
  }));
}

export function channelOf(
  id: string,
  name: string,
  memberCount: number,
  extra: Partial<Channel> = {}
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
    memberCount,
    lastMessageAt: minsAgo(2),
    role: "owner",
    isMember: true,
    lastReadAt: minsAgo(1),
    unread: false,
    myNotifyScope: null,
    myAgentToolProfile: null,
    myFavoritedAt: null,
    onlineMemberCount: memberCount,
    container: { id: "ws-1", kind: "standard", segment: "ws-1-aaaaaa" },
    myWorkspaceRole: "owner",
    peers: [],
    mentionCount: 0,
    linkOut: null,
    infoCard: EMPTY_INFO_CARD,
    ...extra,
  };
}

export function threadOf(
  channelId: string,
  id: string,
  title: string,
  createdBy: string,
  minutesAgo: number
): ChannelThread {
  return {
    id,
    channelId,
    workspaceId: WORKSPACE_ID,
    title,
    status: "open",
    outcome: null,
    mode: "interactive",
    createdBy,
    targetUserId: null,
    createdAt: minsAgo(minutesAgo),
    updatedAt: minsAgo(minutesAgo),
    closedAt: null,
    outcomeSummary: null,
    lastActivityAt: minsAgo(minutesAgo),
  };
}

/** Options for one scripted post. */
export type PostOpts = {
  /** The agent that wrote it (its owner is `author`); absent = the member wrote it. */
  agent?: string;
  thread?: string;
  system?: boolean;
  device?: "computer" | "phone" | "glasses";
};

const DEVICE = {
  computer: { kind: "computer", device_id: "stg-dev-mac", label: "MacBook Pro", platform: "macos" },
  phone: { kind: "phone", device_id: "stg-dev-phone", label: "iPhone", platform: "ios" },
  glasses: { kind: "glasses", device_id: "stg-dev-g2", label: "Even G2", platform: "even_g2" },
} as const;

/** A per-channel post factory: ids `<prefix>-m<n>`, seq ascending. */
export function postsFor(channelId: string, prefix: string) {
  let seq = 0;
  const perAgent = new Map<string, number>();
  return (
    author: string | null,
    body: string,
    minutesAgo: number,
    opts: PostOpts = {}
  ): ChannelMessage => {
    seq += 1;
    const n = (perAgent.get(opts.agent ?? "") ?? 0) + 1;
    if (opts.agent) perAgent.set(opts.agent, n);
    return {
      id: `${prefix}-m${seq}`,
      seq,
      channelId,
      authorUserId: author,
      authorKind: opts.system ? "system" : opts.agent ? "agent" : "user",
      kind: opts.system ? "system" : "message",
      body,
      metadata: {
        ...mentionMetadata(body, author),
        ...(opts.thread ? { taskId: opts.thread } : {}),
        ...(opts.device ? { source: DEVICE[opts.device] } : {}),
      },
      clientMsgId: opts.agent ? `agent-${opts.agent}-${n}` : null,
      createdAt: minsAgo(minutesAgo),
      authorName: DEMO_MEMBERS.find((m) => m.userId === author)?.displayName ?? null,
      authorAvatarUrl: null,
    };
  };
}

function agentName(agentId: string): string {
  const name = stagingAgentIndex().get(agentId)?.displayName;
  if (!name) throw new Error(`channels staging: no agent ${agentId}`);
  return name;
}

export function ownSessionOf(
  channelId: string,
  channelName: string,
  agentId: string,
  thread: ChannelThread | null,
  startedMinsAgo: number,
  contextUsed: number,
  state: DesktopSessionSummary["state"] = "working"
): DesktopSessionSummary {
  const name = agentName(agentId);
  return {
    sessionId: `stg-session-${agentId}`,
    channelId,
    taskId: thread?.id ?? "",
    agentId,
    name: agentId,
    displayName: name,
    state,
    channelName,
    threadTitle: thread?.title ?? null,
    identityName: name,
    contextUsed,
    contextWindow: 200_000,
    tokensSpent: Math.round(contextUsed * 2.4),
    startedAt: NOW_MS - startedMinsAgo * 60_000,
    lastActivityAt: NOW_MS - 20_000,
  };
}

export function peerOf(
  channelId: string,
  channelName: string,
  userId: string,
  agentId: string,
  thread: ChannelThread | null = null,
  state: ChannelPeerSession["state"] = "working"
): ChannelPeerSession {
  const entry = stagingAgentIndex().get(agentId);
  return {
    channelId,
    threadId: thread?.id ?? null,
    name: agentId,
    displayName: agentName(agentId),
    color: entry?.color ?? undefined,
    state,
    channelName,
    threadTitle: thread?.title ?? null,
    updatedAt: minsAgo(0),
    userId,
  };
}

/** The viewer's mention row for `message` (author must be someone else). */
export function mentionOf(message: ChannelMessage, read: boolean): ChannelMention {
  const author = message.authorUserId ?? U.grace;
  const agentId =
    message.authorKind === "agent" && message.clientMsgId
      ? (message.clientMsgId.split("-")[1] ?? null)
      : null;
  const entry = agentId ? stagingAgentIndex().get(agentId) : undefined;
  const body = message.body;
  return {
    messageId: message.id,
    seq: message.seq,
    channelId: message.channelId,
    threadId: (message.metadata?.taskId as string | undefined) ?? null,
    authorUserId: author,
    authorKind: message.authorKind,
    authorName: message.authorName,
    authorAvatarUrl: FACE[author as keyof typeof FACE] ?? null,
    authorAgentId: agentId,
    authorAgentName: entry?.displayName ?? null,
    authorAgentColor: entry?.color ?? null,
    snippet: body.length <= 90 ? body : `${body.slice(0, 88).trimEnd()}…`,
    createdAt: message.createdAt,
    read,
  };
}

/** 1:1 lane entries for an agent view, seconds back from the clock. */
export function dmOf(
  lane: "operator" | "private",
  text: string,
  secondsAgo: number
): DesktopNarrationEntry {
  return { at: NOW_MS - secondsAgo * 1000, kind: lane, lane, text };
}

/** A channel message as it arrived for an agent (the "Received from" box). */
export function inboundOf(message: ChannelMessage, secondsAgo: number): DesktopNarrationEntry {
  const agentId =
    message.authorKind === "agent" && message.clientMsgId
      ? (message.clientMsgId.split("-")[1] ?? null)
      : null;
  const entry = agentId ? stagingAgentIndex().get(agentId) : undefined;
  const senderName = entry?.displayName ?? message.authorName ?? "Member";
  return {
    at: NOW_MS - secondsAgo * 1000,
    kind: "inbound",
    lane: "inbound",
    text: message.body,
    senderName,
    authorKind: agentId ? "agent" : "user",
    ...(agentId ? { senderAgentName: senderName, senderColor: entry?.color ?? undefined } : {}),
  };
}

/** 31 UTC days of message counts, as `demo-info-data.ts › ACTIVITY_BINS` shapes them. */
export function activityOf(counts: readonly number[]): ActivityBin[] {
  const DAY = 86_400_000;
  return counts.map((count, i) => ({
    date: new Date(NOW_MS - (counts.length - 1 - i) * DAY).toISOString().slice(0, 10),
    count,
  }));
}
