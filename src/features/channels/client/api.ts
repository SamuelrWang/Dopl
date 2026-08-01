import { ApiError, apiRequest } from "@/shared/api/api-client";
import type {
  AgentStatus,
  AgentToolProfile,
  AgentTrustRule,
  Channel,
  ChannelAgent,
  ChannelConsentRequest,
  ChannelMember,
  ChannelMessage,
  ChannelThread,
  ChannelVisibility,
  MessageIntent,
  NotifyScope,
  ThreadMode,
  ThreadOutcome,
} from "../types";

/** Domain error wrapper so components can branch on `code`. */
export class ChannelApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ChannelApiError";
  }
}

interface RequestOpts {
  workspaceId?: string;
  body?: unknown;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError) {
      throw new ChannelApiError(err.status, err.code, err.message);
    }
    throw err;
  }
}

function channelPath(channelId: string, tail = ""): string {
  return `/api/channels/${encodeURIComponent(channelId)}${tail}`;
}

/**
 * Create-channel body: a normal channel (`name`, ...) OR a direct channel
 * (`direct: true` + `memberUserId`). The server dedups a repeat DM to the same
 * peer and returns the existing channel.
 */
export type ChannelCreateBody =
  | {
      name: string;
      slug?: string;
      topic?: string;
      visibility?: ChannelVisibility;
      direct?: false;
    }
  | { direct: true; memberUserId: string };

export async function createChannel(
  body: ChannelCreateBody,
  workspaceId: string
): Promise<Channel> {
  const data = await request<{ channel: Channel }>("/api/channels", {
    method: "POST",
    body,
    workspaceId,
  });
  return data.channel;
}

export interface ChannelPatch {
  name?: string;
  topic?: string;
  visibility?: ChannelVisibility;
  archived?: boolean;
}

export async function updateChannel(
  channelId: string,
  patch: ChannelPatch,
  workspaceId: string
): Promise<Channel> {
  const data = await request<{ channel: Channel }>(channelPath(channelId), {
    method: "PATCH",
    body: patch,
    workspaceId,
  });
  return data.channel;
}

export async function deleteChannel(
  channelId: string,
  workspaceId: string
): Promise<void> {
  await request<void>(channelPath(channelId), {
    method: "DELETE",
    workspaceId,
  });
}

export interface PostMessageBody {
  body: string;
  kind?: ChannelMessage["kind"];
  authorKind?: ChannelMessage["authorKind"];
  metadata?: Record<string, unknown>;
  clientMsgId?: string;
  /** Address the message to a specific member's agent. */
  toUserId?: string;
  /** One-line intent (shown in the receiver's consent prompt). */
  summary?: string;
  /** Says this post is chat, so nothing infers a request from a missing field. */
  intent?: MessageIntent;
  /**
   * The agents this message addresses — agent ids or handles, capped at the
   * schema's `MAX_ADDRESSED_AGENTS`. The composer fills it by resolving the
   * body's `@handle` tokens against the channel roster (`lib/mention.ts`), and
   * it is the ONLY addressing a chat message may carry: those agents act, and
   * the server engages them for the untagged human messages that follow.
   */
  toAgents?: string[];
}

export async function postMessage(
  channelId: string,
  body: PostMessageBody,
  workspaceId: string
): Promise<ChannelMessage> {
  const data = await request<{ message: ChannelMessage }>(
    channelPath(channelId, "/messages"),
    { method: "POST", body, workspaceId }
  );
  return data.message;
}

export async function addChannelMember(
  channelId: string,
  userId: string,
  workspaceId: string
): Promise<ChannelMember> {
  const data = await request<{ member: ChannelMember }>(
    channelPath(channelId, "/members"),
    { method: "POST", body: { userId }, workspaceId }
  );
  return data.member;
}

export async function removeChannelMember(
  channelId: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  await request<void>(channelPath(channelId, "/members"), {
    method: "DELETE",
    body: { userId },
    workspaceId,
  });
}

/** Set the caller's own notification scope for a channel. */
export async function updateMyNotifyScope(
  channelId: string,
  notifyScope: NotifyScope,
  workspaceId: string
): Promise<ChannelMember> {
  const data = await request<{ member: ChannelMember }>(
    channelPath(channelId, "/members"),
    { method: "PATCH", body: { notifyScope }, workspaceId }
  );
  return data.member;
}

/** Set the caller's own responding-agent tool profile for a channel. */
export async function updateMyToolProfile(
  channelId: string,
  agentToolProfile: AgentToolProfile,
  workspaceId: string
): Promise<ChannelMember> {
  const data = await request<{ member: ChannelMember }>(
    channelPath(channelId, "/members"),
    { method: "PATCH", body: { agentToolProfile }, workspaceId }
  );
  return data.member;
}

// ─── Threads ────────────────────────────────────────────────────────
//
// THE CLIENT BOUNDARY: wire/storage name `task` == domain name `thread`. The
// route segment (`/tasks`) and the response envelope keys (`tasks` / `task`)
// are STORAGE names and stay put — renaming them means a migration plus every
// read and write path. Every function below hands the rest of the web a
// `thread`.

/** Every thread in a channel (feeds the transcript's status overlay). */
export async function listChannelThreads(
  channelId: string,
  workspaceId: string
): Promise<ChannelThread[]> {
  const data = await request<{ tasks: ChannelThread[] }>(
    channelPath(channelId, "/tasks"),
    { workspaceId }
  );
  return data.tasks ?? [];
}

/** Open a thread addressed to a channel member. */
export async function createChannelThread(
  channelId: string,
  body: { title: string; mode?: ThreadMode; body: string; toUserId: string },
  workspaceId: string
): Promise<ChannelThread> {
  const data = await request<{ task: ChannelThread }>(
    channelPath(channelId, "/tasks"),
    { method: "POST", body, workspaceId }
  );
  return data.task;
}

/** Close a thread (creator or target) with an outcome + optional close summary. */
export async function closeChannelThread(
  channelId: string,
  threadId: string,
  body: { outcome: ThreadOutcome; summary?: string },
  workspaceId: string
): Promise<ChannelThread> {
  const data = await request<{ task: ChannelThread }>(
    channelPath(channelId, `/tasks/${encodeURIComponent(threadId)}`),
    { method: "PATCH", body: { op: "close", ...body }, workspaceId }
  );
  return data.task;
}

/**
 * Reopen a closed thread (creator or target). Web-only — there is no MCP
 * counterpart (agents never reopen); the server clears the closed state and
 * posts no lifecycle echo, so the card flips back to active on the next refetch.
 */
export async function reopenChannelThread(
  channelId: string,
  threadId: string,
  workspaceId: string
): Promise<ChannelThread> {
  const data = await request<{ task: ChannelThread }>(
    channelPath(channelId, `/tasks/${encodeURIComponent(threadId)}`),
    { method: "PATCH", body: { op: "reopen" }, workspaceId }
  );
  return data.task;
}

/** Set a thread's mode (creator only). */
export async function setChannelThreadMode(
  channelId: string,
  threadId: string,
  body: { mode: ThreadMode },
  workspaceId: string
): Promise<ChannelThread> {
  const data = await request<{ task: ChannelThread }>(
    channelPath(channelId, `/tasks/${encodeURIComponent(threadId)}`),
    { method: "PATCH", body: { op: "set_mode", ...body }, workspaceId }
  );
  return data.task;
}

// ─── Agents ─────────────────────────────────────────────────────────
//
// The agent route surface, all of it live:
//
//   POST   /api/channels/[channelId]/agents { name? }  -> 201 { agent }
//   PATCH  /api/channels/[channelId]/agents/[agentId]
//            { op: "rename",     name }                -> { agent }
//            { op: "set_status", status }              -> { agent }
//            { op: "disengage" }                       -> { agent }
//
// `disengage` is the ENGAGEMENT contract's write (`server/service-agents.ts`;
// see `lib/agent-engagement.ts` for the matching read fields). It clears the
// agent's `engaged_at` so it stops listening to the channel; it does NOT park
// or dismiss, because an agent that stopped listening is still a member.
//
// The WRITES only. `GET /api/channels/[channelId]/agents -> { agents }` has no
// wrapper here on purpose: `use-channel-agents.ts` reads it through
// `useApiQuery`, which owns the cache key, and a second entry point would be a
// read the cache never sees.
//
// The agent's handle is picked SERVER-side from the curated pool when `name` is
// omitted (`server/agent-names.ts`), so the composer's bare `/new-agent` sends
// no name at all rather than inventing one.

/** The path of one agent under its channel. */
function agentPath(channelId: string, agentId: string): string {
  return channelPath(
    channelId,
    `/agents/${encodeURIComponent(agentId)}`
  );
}

/** Summon an agent of your own. Omit `name` to take the next pool handle. */
export async function createChannelAgent(
  channelId: string,
  name: string | undefined,
  workspaceId: string
): Promise<ChannelAgent> {
  const data = await request<{ agent: ChannelAgent }>(
    channelPath(channelId, "/agents"),
    { method: "POST", body: name ? { name } : {}, workspaceId }
  );
  return data.agent;
}

/** Rename your own agent (owner-only; the server re-checks). */
export async function renameChannelAgent(
  channelId: string,
  agentId: string,
  name: string,
  workspaceId: string
): Promise<ChannelAgent> {
  const data = await request<{ agent: ChannelAgent }>(
    agentPath(channelId, agentId),
    { method: "PATCH", body: { op: "rename", name }, workspaceId }
  );
  return data.agent;
}

/** Park / resume / dismiss your own agent (owner-only; the server re-checks). */
export async function setChannelAgentStatus(
  channelId: string,
  agentId: string,
  status: AgentStatus,
  workspaceId: string
): Promise<ChannelAgent> {
  const data = await request<{ agent: ChannelAgent }>(
    agentPath(channelId, agentId),
    { method: "PATCH", body: { op: "set_status", status }, workspaceId }
  );
  return data.agent;
}

/**
 * Stop your own agent listening to this channel (owner-only; the server
 * re-checks). Leaves its status alone — it is still a member, it is just no
 * longer engaged.
 */
export async function disengageChannelAgent(
  channelId: string,
  agentId: string,
  workspaceId: string
): Promise<ChannelAgent> {
  const data = await request<{ agent: ChannelAgent }>(
    agentPath(channelId, agentId),
    { method: "PATCH", body: { op: "disengage" }, workspaceId }
  );
  return data.agent;
}

// ─── Consent ────────────────────────────────────────────────────────

/** The caller's pending consent inbox (optionally scoped to one channel). */
export async function listConsentRequests(
  workspaceId: string,
  channelId?: string
): Promise<ChannelConsentRequest[]> {
  const data = await request<{ requests: ChannelConsentRequest[] }>(
    "/api/channels/consent",
    { workspaceId, ...(channelId ? { query: { channelId } } : {}) }
  );
  return data.requests ?? [];
}

/** Record the operator's Allow / Deny (or Send / Cancel) decision. */
export async function decideConsent(
  id: string,
  decision: "allow" | "deny",
  workspaceId: string
): Promise<ChannelConsentRequest> {
  const data = await request<{ request: ChannelConsentRequest }>(
    `/api/channels/consent/${encodeURIComponent(id)}`,
    { method: "PATCH", body: { decision }, workspaceId }
  );
  return data.request;
}

// ─── Trust ──────────────────────────────────────────────────────────

/** The caller's standing trust rules in the workspace. */
export async function listTrustRules(
  workspaceId: string
): Promise<AgentTrustRule[]> {
  const data = await request<{ rules: AgentTrustRule[] }>(
    "/api/channels/trust",
    { workspaceId }
  );
  return data.rules ?? [];
}

/** Always allow a teammate's agent (add a standing trust rule). */
export async function addTrustRule(
  trustedUserId: string,
  workspaceId: string
): Promise<AgentTrustRule> {
  const data = await request<{ rule: AgentTrustRule }>("/api/channels/trust", {
    method: "POST",
    body: { trustedUserId },
    workspaceId,
  });
  return data.rule;
}

/** Revoke a standing trust rule. */
export async function removeTrustRule(
  trustedUserId: string,
  workspaceId: string
): Promise<void> {
  await request<void>("/api/channels/trust", {
    method: "DELETE",
    body: { trustedUserId },
    workspaceId,
  });
}
