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
  ChannelUpdateInput,
  ChannelMember,
  ChannelMessage,
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
import type {
  AgentDirectiveCreateInput,
  AgentDirectiveCreated,
  LaunchDirective,
  LaunchDirectiveCreateInput,
  LaunchDirectiveCreated,
} from "./launch-types.js";
import type {
  AgentDirection,
  AgentDirectionCreateInput,
  AgentDirectionCreated,
} from "./direction-types.js";

const enc = encodeURIComponent;

/** Network read-timeout for the long-poll — above the server cap.
 *  ⚠ **EXPORTED FOR A DIFFERENT READER THAN IT WAS.** It was `ping.ts`'s, which
 *  held the SAME route ceiling (`maxDuration` 60); the ping lane and that module
 *  are gone. What reads it now is the DEADLINE CHAIN's gate —
 *  `@dopl/mcp-server › tools/channel-deadlines.test.ts` greps this literal so
 *  the hold budget can never be raised past the network timeout that bounds it.
 *  The reason is unchanged: two copies drift, and the one that drifts low turns
 *  a graceful hold into a transport abort. */
export const AWAIT_TIMEOUT_MS = 55_000;

/**
 * Server-side long-poll window when the caller passes none. Sent explicitly
 * rather than relying on the route default, so poll length is pinned
 * client-side and stays under AWAIT_TIMEOUT_MS.
 *
 * ⚠ EXPORTED for {@link AWAIT_TIMEOUT_MS}'s reader and for its reason — not for
 * `ping.ts`, which is deleted with its lane.
 */
export const DEFAULT_AWAIT_TIMEOUT_MS = 50_000;

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
 * Patch a channel. ⚠ **`infoCard` IS THE ONLY FIELD BOUND HERE, AND THAT IS A
 * RULING, NOT A GAP** (Samuel's ruling Q12, 2026-08-28).
 *
 * `PATCH /api/channels/{id}` also accepts `name`, `topic`, `archived` and
 * `visibility`. `visibility` is field-level `sessionOnly` and an agent token is
 * refused it outright. The other three are MANAGE writes the route accepts and
 * **no UI can ask for** (F-346) — shipping RENAME first on the AGENT surface
 * would mean the operator's only way to undo one is to ask an agent. So
 * {@link ChannelUpdateInput} carries one key, and widening it is a product
 * decision rather than a type edit.
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

// ─── Launch directives (launch-over-MCP, 2026-08-22) ────────────────

/**
 * ASK THE OPERATOR'S OWN DESKTOP TO START AN AGENT.
 *
 * ⚠ A REQUEST, NOT A COMMAND. The server files a row; the machine decides. The
 * `offline` branch means the machine is not listening and NOTHING WAS FILED.
 * ⚠ There is no operator argument, by design — see
 * {@link LaunchDirectiveCreateInput}.
 */
export async function createLaunchDirective(
  t: DoplTransport,
  input: LaunchDirectiveCreateInput
): Promise<LaunchDirectiveCreated> {
  return t.request<LaunchDirectiveCreated>("/api/channels/launch-directives", {
    method: "POST",
    body: input,
    toolName: "channel_launch_agent",
  });
}

/**
 * ASK THE OPERATOR'S OWN DESKTOP TO **END** OR **RENAME** ONE OF ITS AGENTS
 * (2026-09-01).
 *
 * ⚠ **THE SAME MAILBOX, A DIFFERENT KIND — so the result is a `LaunchDirective`
 * and `getLaunchDirective` polls it.** There is no second lane and no second poll
 * endpoint; only the CREATE body differs, because a launch's shape (goal, model,
 * template) and an end's (which agent) have nothing in common.
 * ⚠ A REQUEST, NOT A COMMAND, exactly as a launch is. `offline` means the machine
 * is not listening and NOTHING WAS FILED.
 * ⚠ **NO LAUNCH TOGGLE APPLIES TO THESE TWO.** The desktop's launch-over-MCP
 * setting gates `launch_agent` and neither of these; do not tell a caller to turn
 * it on because an end was refused.
 */
export async function createAgentDirective(
  t: DoplTransport,
  input: AgentDirectiveCreateInput
): Promise<AgentDirectiveCreated> {
  return t.request<AgentDirectiveCreated>(
    "/api/channels/launch-directives/agent",
    {
      method: "POST",
      body: input,
      toolName: "channel_agent_directive",
    }
  );
}

/**
 * POLL ONE DIRECTIVE — what a bounded hold reads while the desktop decides.
 *
 * ⚠ COARSE POLLING ONLY (1-2s). A directive lives at most two minutes and the
 * decision is a human-scale toggle plus a process spawn; polling faster buys
 * nothing and multiplies requests across every armed launch.
 * ⚠ Another operator's directive answers 404, indistinguishable from absent.
 */
export async function getLaunchDirective(
  t: DoplTransport,
  id: string
): Promise<LaunchDirective> {
  const data = await t.request<{ directive: LaunchDirective }>(
    `/api/channels/launch-directives/${enc(id)}`,
    { toolName: "channel_launch_poll" }
  );
  return data.directive;
}

// ── THE PRIVATE DIRECT LANE (2026-08-31) ───────────────────────────────────
//
// ⚠ THE SIBLING OF THE LAUNCH MAILBOX ABOVE, AND NOT A MODE OF IT. A launch asks
// for a PROCESS; a direction asks an EXISTING one to hear something privately.
// ⚠ `claim` AND `decide` ARE DELIBERATELY ABSENT, exactly as they are for
// launches: those two routes are consumed only by the DESKTOP, which addresses
// them by path from `main/agent-direction-wire.js`. Binding them on this client
// would publish verbs the MCP surface must never be able to reach.

export async function createAgentDirection(
  t: DoplTransport,
  input: AgentDirectionCreateInput
): Promise<AgentDirectionCreated> {
  return t.request<AgentDirectionCreated>("/api/channels/agent-directions", {
    method: "POST",
    body: input,
    toolName: "channel_direct_agent",
  });
}

export async function getAgentDirection(
  t: DoplTransport,
  id: string
): Promise<AgentDirection> {
  const data = await t.request<{ direction: AgentDirection }>(
    `/api/channels/agent-directions/${enc(id)}`,
    { toolName: "channel_direct_poll" }
  );
  return data.direction;
}

/** The caller's own recent directions — what `op="read_directions"` renders.
 *  ⚠ TERMINAL ROWS INCLUDED, unlike the desktop's backstop read: the `reply` is
 *  the whole reason this op exists. */
export async function listAgentDirections(
  t: DoplTransport,
  query: { channel?: string; agent?: string } = {}
): Promise<AgentDirection[]> {
  const params = new URLSearchParams();
  if (query.channel) params.set("channel", query.channel);
  if (query.agent) params.set("agent", query.agent);
  const qs = params.toString();
  const data = await t.request<{ directions: AgentDirection[] }>(
    `/api/channels/agent-directions/recent${qs ? `?${qs}` : ""}`,
    { toolName: "channel_read_directions" }
  );
  return data.directions;
}
