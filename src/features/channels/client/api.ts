import { ApiError, apiRequest } from "@/shared/api/api-client";
import type {
  AgentToolProfile,
  AgentTrustRule,
  Channel,
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

// NO `listChannelThreads` WRAPPER. `GET /tasks` is read by `use-channel-threads.ts` through
// `useApiQuery`, which owns the cache key; the bare wrapper here had no caller and would have
// been a read the cache never sees. Same reasoning as the agents roster below.

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

// NO `setChannelThreadMode` WRAPPER. `PATCH {op:"set_mode"}` is an MCP/desktop act — the web
// thread panel offers close and reopen and nothing else — so the wrapper had no caller. The
// route and `@dopl/client.setChannelThreadMode` are untouched.

// ─── Agents ─────────────────────────────────────────────────────────
//
// NO WRAPPERS, and that is the whole entry. `POST /agents` (summon) and
// `PATCH /agents/[agentId]` (rename / set_status / disengage) had one each, and
// the routes are gone with named agents (rollback §1).
//
// One route survives and deliberately has no wrapper here, exactly as before:
// `GET /api/channels/[channelId]/agents -> { agents }`, the historical
// attribution roster. `use-channel-agents.ts` reads it through `useApiQuery`,
// which owns the cache key, and a second entry point would be a read the cache
// never sees.

// ─── Consent ────────────────────────────────────────────────────────

// NO `listConsentRequests` WRAPPER — the consent inbox is a `useApiQuery` read like the
// rosters, so the cache owns the key; only the DECIDE write goes through here.

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

// NO `listTrustRules` WRAPPER — same reason as the consent inbox: the standing rules are a
// `useApiQuery` read, and only the add / delete writes go through here.

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
