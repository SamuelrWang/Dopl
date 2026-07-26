import { ApiError, apiRequest } from "@/shared/api/api-client";
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelVisibility,
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
