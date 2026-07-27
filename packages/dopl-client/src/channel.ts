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
  ChannelTask,
  ChannelTaskCreateInput,
  ReadMessagesOptions,
  TaskMode,
  TaskOutcome,
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

// ─── Tasks ──────────────────────────────────────────────────────────

export async function createChannelTask(
  t: DoplTransport,
  channelId: string,
  input: ChannelTaskCreateInput
): Promise<ChannelTask> {
  const data = await t.request<{ task: ChannelTask }>(
    `/api/channels/${enc(channelId)}/tasks`,
    {
      method: "POST",
      body: input,
      toolName: "channel_create_task",
    }
  );
  return data.task;
}

export async function closeChannelTask(
  t: DoplTransport,
  channelId: string,
  taskId: string,
  input: { outcome: TaskOutcome }
): Promise<ChannelTask> {
  const data = await t.request<{ task: ChannelTask }>(
    `/api/channels/${enc(channelId)}/tasks/${enc(taskId)}`,
    {
      method: "PATCH",
      body: { op: "close", outcome: input.outcome },
      toolName: "channel_close_task",
    }
  );
  return data.task;
}

export async function setChannelTaskMode(
  t: DoplTransport,
  channelId: string,
  taskId: string,
  input: { mode: TaskMode }
): Promise<ChannelTask> {
  const data = await t.request<{ task: ChannelTask }>(
    `/api/channels/${enc(channelId)}/tasks/${enc(taskId)}`,
    {
      method: "PATCH",
      body: { op: "set_mode", mode: input.mode },
      toolName: "channel_set_task_mode",
    }
  );
  return data.task;
}
