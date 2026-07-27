import { ApiError, apiRequest } from "@/shared/api/api-client";
import type {
  AgentToolProfile,
  AgentTrustRule,
  Channel,
  ChannelConsentRequest,
  ChannelMember,
  ChannelMessage,
  ChannelVisibility,
  NotifyScope,
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

export interface ChannelCreateBody {
  name: string;
  slug?: string;
  topic?: string;
  visibility?: ChannelVisibility;
}

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
