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
  ChannelArtifact,
  ChannelArtifactAction,
  ChannelArtifactResult,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelMember,
  ChannelMessage,
  ChannelReadEntry,
  ChannelMessageInput,
  ChannelMessagePosted,
  ChannelSessionStateOwn,
  ChannelSessionsPage,
  ChannelThread,
  ChannelThreadCreated,
  ChannelThreadCreateInput,
  ChannelThreadPage,
  ReadMessagesOptions,
  WorkspaceAwaitResult,
  ThreadMode,
} from "./channel-types.js";

const enc = encodeURIComponent;

/** Network read-timeout for the long-poll — above the server cap.
 *  ⚠ EXPORTED for the DEADLINE CHAIN's gate, not for the deleted `ping.ts`:
 *  `@dopl/mcp-server › tools/channel-deadlines.test.ts` greps this literal so
 *  the hold budget cannot be raised past the timeout bounding it. Two copies
 *  drift, and the one that drifts low aborts a graceful hold. */
export const AWAIT_TIMEOUT_MS = 55_000;

/**
 * Server-side long-poll window when the caller passes none. Sent explicitly
 * rather than relying on the route default, so poll length is pinned
 * client-side and stays under AWAIT_TIMEOUT_MS.
 *
 * ⚠ EXPORTED for {@link AWAIT_TIMEOUT_MS}'s reader, and for its reason.
 */
export const DEFAULT_AWAIT_TIMEOUT_MS = 50_000;

// ─── Read ───────────────────────────────────────────────────────────

/**
 * ⚠ **`opts.includeArchived` IS DELETED (Samuel's ruling R-21, 2026-09-17).** It
 * set `?include=archived`, the route's only query param, so a caller could see
 * rooms the archive filter hid. Both the filter and the feature are gone: this
 * read answers every live channel the caller may see, archived-stamped rows
 * included.
 */
export async function listChannels(t: DoplTransport): Promise<Channel[]> {
  const data = await t.request<{ channels: Channel[] }>("/api/channels", {
    toolName: "channel_list",
  });
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

/**
 * THE SAME READ, KEEPING THE FOLD — messages plus `entries` when the page
 * actually folded something (#1220 §4).
 *
 * ⚠ **`entries: null` MEANS "NOTHING ON THIS PAGE IS IN AN ARTIFACT", AND SO
 * DOES AN OLDER SERVER THAT OMITS THE KEY.** Both collapse to the same handling
 * — render the messages — which is why one nullable field is enough and no
 * version probe is needed.
 * ⚠ **`readMessages` ABOVE IS UNCHANGED AND STAYS.** Every installed caller is
 * artifact-unaware; this is the additive twin for one that is not.
 */
export async function readTranscript(
  t: DoplTransport,
  channelId: string,
  opts: ReadMessagesOptions = {}
): Promise<{ messages: ChannelMessage[]; entries: ChannelReadEntry[] | null }> {
  const params = new URLSearchParams();
  if (opts.since !== undefined) params.set("since", String(opts.since));
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.thread !== undefined) params.set("thread", opts.thread);
  const qs = params.toString();
  const data = await t.request<{
    messages: ChannelMessage[];
    entries?: ChannelReadEntry[];
  }>(`/api/channels/${enc(channelId)}/messages${qs ? `?${qs}` : ""}`, {
    toolName: "channel_read",
  });
  return { messages: data.messages, entries: data.entries ?? null };
}

/**
 * `op="artifact"` — create / add / remove / dissolve, one POST.
 *
 * ⚠ **THERE IS NO `delete`, AND THAT IS THE WHOLE SAFETY ARGUMENT.**
 * `dissolve` clears the column from every member and retires the card; nothing
 * is deleted, so every action on this surface is reversible in the way the rest
 * of this client's writes are.
 */
export async function writeArtifact(
  t: DoplTransport,
  channelId: string,
  input: ChannelArtifactAction
): Promise<ChannelArtifactResult> {
  return t.request<ChannelArtifactResult>(
    `/api/channels/${enc(channelId)}/artifacts`,
    { method: "POST", body: input, toolName: "channel_artifact" }
  );
}

/** OPEN ONE CARD — its members verbatim, in seq order, unfolded (#1220 §4).
 *  ⚠ `truncated` says the member list hit its ceiling; never drop it. */
export async function readArtifact(
  t: DoplTransport,
  channelId: string,
  artifactId: string
): Promise<{
  artifact: ChannelArtifact;
  messages: ChannelMessage[];
  truncated: boolean;
}> {
  return t.request(
    `/api/channels/${enc(channelId)}/artifacts?artifact=${enc(artifactId)}`,
    { toolName: "channel_artifact_read" }
  );
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

/**
 * WORKSPACE-WIDE long-poll — the `channel`-less await. Holds across every channel
 * the caller is a MEMBER of and returns the moment anything lands.
 *
 * ⚠ SAME BOUNDS AS {@link awaitMessages}, deliberately: one call stays at ~50s
 * because `/api/channels/await` has `maxDuration` 60, and a multi-minute hold is
 * assembled ABOVE this layer by re-issuing on the same cursor. ⚠ `retries: 0` —
 * a retry opens a SECOND long-poll and can double-count arrivals.
 *
 * ⚠ It is NARROWER than `op="read"`: a PUBLIC channel the caller never joined is
 * not watched. `channelCount` on the result says how many channels were being
 * watched, so ZERO memberships is reported rather than rendered as silence.
 */
export async function awaitWorkspaceMessages(
  t: DoplTransport,
  opts: AwaitMessagesOptions
): Promise<WorkspaceAwaitResult> {
  const params = new URLSearchParams();
  params.set("since", String(opts.since));
  params.set("timeoutMs", String(opts.timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS));
  if (opts.excludeAuthor !== undefined) {
    params.set("excludeAuthor", opts.excludeAuthor);
  }
  return t.request<WorkspaceAwaitResult>(
    `/api/channels/await?${params.toString()}`,
    {
      method: "GET",
      timeoutMs: AWAIT_TIMEOUT_MS,
      // ⚠ A retry opens a second long-poll — never auto-retry this one.
      retries: 0,
      toolName: "channel_await_workspace",
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

/**
 * Patch a channel: `name`, `topic` and `infoCard`.
 *
 * `PATCH /api/channels/{id}` also accepts `visibility`, which is field-level
 * `sessionOnly` — an agent token is refused it outright, so
 * {@link ChannelUpdateInput} does not carry it. `name` / `topic` are MANAGE
 * writes (owner or workspace admin).
 *
 * `infoCard` is intentionally AGENT-WRITABLE and gated on MEMBERSHIP rather than
 * session: the card is the channel's shared scratch surface and changes no
 * visibility, roster, lifecycle or fact.
 */
export async function updateChannel(
  t: DoplTransport,
  channelId: string,
  patch: ChannelUpdateInput
): Promise<Channel> {
  const data = await t.request<{ channel: Channel }>(
    `/api/channels/${enc(channelId)}`,
    { method: "PATCH", body: patch, toolName: "channel_update" }
  );
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
 * Post a message.
 *
 * ⚠ The response envelope carried a second key, `threadClosed`, until thread
 * closing was removed (wiring plan Phase 4, 2026-08-18) — normalized to a
 * boolean HERE, because an older deployment sent no key and the caller must not
 * have to tell "false" from "unknown". The shape of that rule still applies to
 * every additive envelope field this client reads.
 */
export async function postMessage(
  t: DoplTransport,
  channelId: string,
  input: ChannelMessageInput
): Promise<ChannelMessagePosted> {
  const data = await t.request<{ message: ChannelMessage }>(
    `/api/channels/${enc(channelId)}/messages`,
    { method: "POST", body: input, toolName: "channel_post" }
  );
  return data.message;
}

// ─── Threads ────────────────────────────────────────────────────────
//
// ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`. Route segment
// (`/tasks`) and envelope keys (`tasks` / `task`) are STORAGE names and stay —
// renaming means a migration plus every read and write path. Everything above
// this line speaks `thread`.

/**
 * A channel's threads, MOST RECENTLY ACTIVE FIRST — the server's order, which
 * is the only order (`repository-tasks.ts › listTasksByChannel`). ⚠ Do not
 * re-sort: the server's LIMIT clipped against that order, so a re-sorted list is
 * the wrong rows in a plausible order.
 *
 * `truncated` rides through from the envelope; an older server that does not
 * send it reads as `false`, which is the pre-existing behaviour (an unbounded
 * read never clipped), not a claim.
 */
export async function listChannelThreads(
  t: DoplTransport,
  channelId: string
): Promise<ChannelThreadPage> {
  const data = await t.request<{ tasks: ChannelThread[]; truncated?: boolean }>(
    `/api/channels/${enc(channelId)}/tasks`,
    { toolName: "channel_list_threads" }
  );
  return { threads: data.tasks, truncated: data.truncated === true };
}

/**
 * The caller's OWN live sessions. `channelId` narrows to one channel; omitted =
 * all of the caller's in the active workspace. ⚠ Own-scoped server-side — a
 * peer's sessions never come back.
 */
/**
 * The caller's OWN sessions. ⚠ OWN-SCOPED AT THE SERVER (`ctx.userId`), which is
 * what licenses the operator-only telemetry on the returned shape — a PEER's
 * session comes back from `GET /api/channels/[channelId]/sessions` instead, and
 * carries the coarse projection only.
 */
export async function listChannelSessions(
  t: DoplTransport,
  channelId?: string
): Promise<ChannelSessionsPage> {
  const query = channelId ? `?channelId=${enc(channelId)}` : "";
  const data = await t.request<{
    sessions: ChannelSessionStateOwn[];
    operatorOnline?: boolean;
  }>(`/api/channels/sessions${query}`, { toolName: "channel_read_sessions" });
  return {
    sessions: data.sessions,
    // ⚠ NARROWED TO A REAL BOOLEAN OR NOTHING, never passed through. An older
    // deployment sends no key and a malformed one could send anything; both must
    // land on `undefined` ("not reported"), because the render's three-state rule
    // turns a truthy non-boolean into a claim that the machine is alive. Same
    // discipline `createChannelThread` applies to `openingSeq`.
    ...(typeof data.operatorOnline === "boolean"
      ? { operatorOnline: data.operatorOnline }
      : {}),
  };
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
 * ⚠ TWO BINDINGS ENDED HERE with thread closing (wiring plan Phase 4,
 * 2026-08-18): `proposeChannelThreadClose` (`PATCH … {op:"propose_close"}`, the
 * agent lane's terminal act) and `closeChannelThread` (`{op:"close"}`, human
 * lane only). The route arms behind both are deleted, so a resurrected binding
 * would 400 on the discriminator rather than fail quietly.
 */

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

// ─── Launch directives + the private direct lane ────────────────────
//
// ⚠ **MOVED TO `channel-directives.ts` (2026-09-14) AND RE-EXPORTED UNCHANGED**, so no
// caller moved. The seam is the banner this file already drew: above it is a channel's
// OWN rows, there is a REQUEST TO A MACHINE the server only files. What forced it was
// this file passing the 500-line cap (§1, the `size-check` CI job, F-689).
export {
  createLaunchDirective,
  createAgentDirective,
  getLaunchDirective,
  createAgentDirection,
  getAgentDirection,
  listAgentDirections,
} from "./channel-directives.js";
