/**
 * Channel methods for `DoplClient` — cross-user, agent-to-agent
 * collaboration threads. Free functions over `DoplTransport`; wired into
 * the `DoplClient` class in client.ts.
 *
 * `awaitMessages` is a LONG-POLL: the server holds the request open (up to
 * ~50s) waiting for a message with seq > since. It therefore uses a longer
 * network timeout and disables the transport's GET auto-retry — a retry
 * would open a second poll and could double-count arrivals.
 */

import type { DoplTransport } from "./transport.js";
import type {
  AwaitMessagesOptions,
  AwaitResult,
  Channel,
  ChannelCreateInput,
  ChannelMember,
  ChannelMessage,
  ChannelMessageInput,
  ChannelThread,
  ChannelThreadCreateInput,
  ReadMessagesOptions,
  ThreadMode,
  ThreadOutcome,
} from "./channel-types.js";

const enc = encodeURIComponent;

/** Network read-timeout for the long-poll — safely above the server cap. */
const AWAIT_TIMEOUT_MS = 55_000;

/**
 * Default server-side long-poll window when the caller passes no timeout.
 * Sent explicitly (rather than relying on the route's own default) so the
 * poll length is pinned client-side and stays under AWAIT_TIMEOUT_MS.
 */
const DEFAULT_AWAIT_TIMEOUT_MS = 50_000;

// ─── Read ───────────────────────────────────────────────────────────

export async function listChannels(
  t: DoplTransport,
  opts: { includeArchived?: boolean } = {}
): Promise<Channel[]> {
  const params = new URLSearchParams();
  if (opts.includeArchived) params.set("include", "archived");
  const qs = params.toString();
  const data = await t.request<{ channels: Channel[] }>(
    `/api/channels${qs ? `?${qs}` : ""}`,
    { toolName: "channel_list" }
  );
  return data.channels;
}

export async function getChannel(
  t: DoplTransport,
  channelId: string
): Promise<Channel> {
  const data = await t.request<{ channel: Channel }>(
    `/api/channels/${enc(channelId)}`,
    { toolName: "channel_get" }
  );
  return data.channel;
}

export async function listChannelMembers(
  t: DoplTransport,
  channelId: string
): Promise<ChannelMember[]> {
  const data = await t.request<{ members: ChannelMember[] }>(
    `/api/channels/${enc(channelId)}/members`,
    { toolName: "channel_members" }
  );
  return data.members;
}

export async function readMessages(
  t: DoplTransport,
  channelId: string,
  opts: ReadMessagesOptions = {}
): Promise<ChannelMessage[]> {
  const params = new URLSearchParams();
  if (opts.since !== undefined) params.set("since", String(opts.since));
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const data = await t.request<{ messages: ChannelMessage[] }>(
    `/api/channels/${enc(channelId)}/messages${qs ? `?${qs}` : ""}`,
    { toolName: "channel_read" }
  );
  return data.messages;
}

export async function awaitMessages(
  t: DoplTransport,
  channelId: string,
  opts: AwaitMessagesOptions
): Promise<AwaitResult> {
  const params = new URLSearchParams();
  params.set("since", String(opts.since));
  params.set(
    "timeoutMs",
    String(opts.timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS),
  );
  return t.request<AwaitResult>(
    `/api/channels/${enc(channelId)}/await?${params.toString()}`,
    {
      method: "GET",
      timeoutMs: AWAIT_TIMEOUT_MS,
      // A retry would open a second long-poll — never auto-retry this one.
      retries: 0,
      toolName: "channel_await",
    }
  );
}

// ─── Write ──────────────────────────────────────────────────────────

export async function createChannel(
  t: DoplTransport,
  input: ChannelCreateInput
): Promise<Channel> {
  const data = await t.request<{ channel: Channel }>("/api/channels", {
    method: "POST",
    body: input,
    toolName: "channel_create",
  });
  return data.channel;
}

export async function inviteToChannel(
  t: DoplTransport,
  channelId: string,
  userId: string
): Promise<ChannelMember> {
  const data = await t.request<{ member: ChannelMember }>(
    `/api/channels/${enc(channelId)}/members`,
    {
      method: "POST",
      body: { userId },
      toolName: "channel_invite",
    }
  );
  return data.member;
}

export async function postMessage(
  t: DoplTransport,
  channelId: string,
  input: ChannelMessageInput
): Promise<ChannelMessage> {
  const data = await t.request<{ message: ChannelMessage }>(
    `/api/channels/${enc(channelId)}/messages`,
    {
      method: "POST",
      body: input,
      toolName: "channel_post",
    }
  );
  return data.message;
}

// ─── Threads ────────────────────────────────────────────────────────
//
// BOUNDARY: wire/storage name `task` == domain name `thread`. The route
// segment (`/tasks`) and the response envelope keys (`tasks` / `task`) are
// STORAGE names and stay put — renaming them means a migration plus every
// read and write path. Everything above this line speaks `thread`.

export async function listChannelThreads(
  t: DoplTransport,
  channelId: string
): Promise<ChannelThread[]> {
  const data = await t.request<{ tasks: ChannelThread[] }>(
    `/api/channels/${enc(channelId)}/tasks`,
    { toolName: "channel_list_threads" }
  );
  return data.tasks;
}

export async function getChannelThread(
  t: DoplTransport,
  channelId: string,
  threadId: string
): Promise<ChannelThread> {
  const data = await t.request<{ task: ChannelThread }>(
    `/api/channels/${enc(channelId)}/tasks/${enc(threadId)}`,
    { toolName: "channel_get_thread" }
  );
  return data.task;
}

export async function createChannelThread(
  t: DoplTransport,
  channelId: string,
  input: ChannelThreadCreateInput
): Promise<ChannelThread> {
  const data = await t.request<{ task: ChannelThread }>(
    `/api/channels/${enc(channelId)}/tasks`,
    {
      method: "POST",
      body: input,
      toolName: "channel_create_thread",
    }
  );
  return data.task;
}

export async function closeChannelThread(
  t: DoplTransport,
  channelId: string,
  threadId: string,
  input: { outcome: ThreadOutcome; summary?: string }
): Promise<ChannelThread> {
  const data = await t.request<{ task: ChannelThread }>(
    `/api/channels/${enc(channelId)}/tasks/${enc(threadId)}`,
    {
      method: "PATCH",
      body: { op: "close", outcome: input.outcome, summary: input.summary },
      toolName: "channel_close_thread",
    }
  );
  return data.task;
}

export async function setChannelThreadMode(
  t: DoplTransport,
  channelId: string,
  threadId: string,
  input: { mode: ThreadMode }
): Promise<ChannelThread> {
  const data = await t.request<{ task: ChannelThread }>(
    `/api/channels/${enc(channelId)}/tasks/${enc(threadId)}`,
    {
      method: "PATCH",
      body: { op: "set_mode", mode: input.mode },
      toolName: "channel_set_thread_mode",
    }
  );
  return data.task;
}
