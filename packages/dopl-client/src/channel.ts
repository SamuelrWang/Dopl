/**
 * Channel methods for `DoplClient`. Free functions over `DoplTransport`.
 *
 * `awaitMessages` is a LONG-POLL: server holds the request open (~50s) for a
 * message with seq > since. ⚠ Longer network timeout, GET auto-retry DISABLED
 * — a retry opens a second poll and can double-count arrivals.
 *
 * ONE call stays bounded at ~50s on purpose: `/api/channels/[id]/await` has
 * maxDuration 60s, so a longer single request is killed mid-flight. A
 * multi-minute hold (WAKE-V1) is assembled ABOVE this layer, in the MCP `await`
 * op, by re-issuing with the same cursor.
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
  ChannelMessagePosted,
  ChannelSessionState,
  ChannelThread,
  ChannelThreadCloseProposed,
  ChannelThreadClosed,
  ChannelThreadCreated,
  ChannelThreadCreateInput,
  ReadMessagesOptions,
  ThreadMode,
  ThreadOutcome,
} from "./channel-types.js";

const enc = encodeURIComponent;

/** Network read-timeout for the long-poll — above the server cap. */
const AWAIT_TIMEOUT_MS = 55_000;

/**
 * Server-side long-poll window when the caller passes none. Sent explicitly
 * rather than relying on the route default, so poll length is pinned
 * client-side and stays under AWAIT_TIMEOUT_MS.
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
  // Server filters on `metadata.taskId`. Omitted entirely when unset, so an
  // older deployment sees the read it always saw.
  if (opts.thread !== undefined) params.set("thread", opts.thread);
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
  if (opts.excludeAuthor !== undefined) {
    params.set("excludeAuthor", opts.excludeAuthor);
  }
  return t.request<AwaitResult>(
    `/api/channels/${enc(channelId)}/await?${params.toString()}`,
    {
      method: "GET",
      timeoutMs: AWAIT_TIMEOUT_MS,
      // ⚠ A retry opens a second long-poll — never auto-retry this one.
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

/**
 * Post a message. `threadClosed` rides in the response ENVELOPE beside the
 * message (like `echoSeq`), not inside it, and is normalized to a boolean HERE:
 * an older deployment sends no key, a post into an open thread sends no key,
 * and both must read `false`, not `undefined` for the caller to re-decide.
 */
export async function postMessage(
  t: DoplTransport,
  channelId: string,
  input: ChannelMessageInput
): Promise<ChannelMessagePosted> {
  const data = await t.request<{
    message: ChannelMessage;
    threadClosed?: boolean;
  }>(`/api/channels/${enc(channelId)}/messages`, {
    method: "POST",
    body: input,
    toolName: "channel_post",
  });
  return { ...data.message, threadClosed: data.threadClosed === true };
}

// ─── Threads ────────────────────────────────────────────────────────
//
// ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`. Route segment
// (`/tasks`) and envelope keys (`tasks` / `task`) are STORAGE names and stay —
// renaming means a migration plus every read and write path. Everything above
// this line speaks `thread`.

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

/**
 * The caller's OWN live sessions. `channelId` narrows to one channel; omitted =
 * all of the caller's in the active workspace. ⚠ Own-scoped server-side — a
 * peer's sessions never come back.
 */
export async function listChannelSessions(
  t: DoplTransport,
  channelId?: string
): Promise<ChannelSessionState[]> {
  const query = channelId ? `?channelId=${enc(channelId)}` : "";
  const data = await t.request<{ sessions: ChannelSessionState[] }>(
    `/api/channels/sessions${query}`,
    { toolName: "channel_read_sessions" }
  );
  return data.sessions;
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
): Promise<ChannelThreadCreated> {
  const data = await t.request<{ task: ChannelThread; openingSeq?: number | null }>(
    `/api/channels/${enc(channelId)}/tasks`,
    {
      method: "POST",
      body: input,
      toolName: "channel_create_thread",
    }
  );
  // `openingSeq` is additive on the route — an older deployment omits it,
  // reads as null here, so the caller looks the cursor up rather than arming
  // `await` on `undefined`.
  return {
    thread: data.task,
    openingSeq: typeof data.openingSeq === "number" ? data.openingSeq : null,
  };
}

/**
 * PROPOSE closing a thread — the agent lane's terminal act; agents cannot reach
 * {@link closeChannelThread}. Same route and payload shape, different op: a
 * proposal IS the close it asks a human to confirm, so the confirm hands these
 * two values straight back to `op:"close"`. Writes nothing to the thread row.
 */
export async function proposeChannelThreadClose(
  t: DoplTransport,
  channelId: string,
  threadId: string,
  input: { outcome: ThreadOutcome; summary?: string }
): Promise<ChannelThreadCloseProposed> {
  const data = await t.request<{
    task: ChannelThread;
    markerSeq?: number | null;
    proposedOutcome?: ThreadOutcome;
  }>(`/api/channels/${enc(channelId)}/tasks/${enc(threadId)}`, {
    method: "PATCH",
    body: { op: "propose_close", outcome: input.outcome, summary: input.summary },
    toolName: "channel_propose_close",
  });
  return {
    thread: data.task,
    // Additive on the route; same discipline as `echoSeq` — an absent field is
    // null, never a number the caller could arm a wait on.
    markerSeq: typeof data.markerSeq === "number" ? data.markerSeq : null,
    outcome: data.proposedOutcome ?? input.outcome,
  };
}

/**
 * Close a thread. ⚠ HUMAN LANE ONLY — the server refuses an agent-token caller
 * (`ThreadCloseIsHumanOnlyError`); the agent path is
 * {@link proposeChannelThreadClose}. Kept as the one binding for a real route
 * op — a human surface on this client closes through here.
 */
export async function closeChannelThread(
  t: DoplTransport,
  channelId: string,
  threadId: string,
  input: { outcome: ThreadOutcome; summary?: string }
): Promise<ChannelThreadClosed> {
  const data = await t.request<{ task: ChannelThread; echoSeq?: number | null }>(
    `/api/channels/${enc(channelId)}/tasks/${enc(threadId)}`,
    {
      method: "PATCH",
      body: { op: "close", outcome: input.outcome, summary: input.summary },
      toolName: "channel_close_thread",
    }
  );
  // `echoSeq` is additive, like `openingSeq` on create — an older deployment
  // omits it, reads as null, so the caller looks its cursor up.
  return {
    thread: data.task,
    echoSeq: typeof data.echoSeq === "number" ? data.echoSeq : null,
  };
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
