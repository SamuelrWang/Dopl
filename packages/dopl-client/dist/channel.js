"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listChannels = listChannels;
exports.getChannel = getChannel;
exports.listChannelMembers = listChannelMembers;
exports.readMessages = readMessages;
exports.awaitMessages = awaitMessages;
exports.awaitWorkspaceMessages = awaitWorkspaceMessages;
exports.createChannel = createChannel;
exports.inviteToChannel = inviteToChannel;
exports.postMessage = postMessage;
exports.listChannelThreads = listChannelThreads;
exports.listChannelSessions = listChannelSessions;
exports.getChannelThread = getChannelThread;
exports.createChannelThread = createChannelThread;
exports.setChannelThreadMode = setChannelThreadMode;
exports.createLaunchDirective = createLaunchDirective;
exports.getLaunchDirective = getLaunchDirective;
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
async function listChannels(t, opts = {}) {
    const params = new URLSearchParams();
    if (opts.includeArchived)
        params.set("include", "archived");
    const qs = params.toString();
    const data = await t.request(`/api/channels${qs ? `?${qs}` : ""}`, { toolName: "channel_list" });
    return data.channels;
}
async function getChannel(t, channelId) {
    const data = await t.request(`/api/channels/${enc(channelId)}`, { toolName: "channel_get" });
    return data.channel;
}
async function listChannelMembers(t, channelId) {
    const data = await t.request(`/api/channels/${enc(channelId)}/members`, { toolName: "channel_members" });
    return data.members;
}
async function readMessages(t, channelId, opts = {}) {
    const params = new URLSearchParams();
    if (opts.since !== undefined)
        params.set("since", String(opts.since));
    if (opts.limit !== undefined)
        params.set("limit", String(opts.limit));
    // Server filters on `metadata.taskId`. Omitted entirely when unset, so an
    // older deployment sees the read it always saw.
    if (opts.thread !== undefined)
        params.set("thread", opts.thread);
    const qs = params.toString();
    const data = await t.request(`/api/channels/${enc(channelId)}/messages${qs ? `?${qs}` : ""}`, { toolName: "channel_read" });
    return data.messages;
}
async function awaitMessages(t, channelId, opts) {
    const params = new URLSearchParams();
    params.set("since", String(opts.since));
    params.set("timeoutMs", String(opts.timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS));
    if (opts.excludeAuthor !== undefined) {
        params.set("excludeAuthor", opts.excludeAuthor);
    }
    return t.request(`/api/channels/${enc(channelId)}/await?${params.toString()}`, {
        method: "GET",
        timeoutMs: AWAIT_TIMEOUT_MS,
        // ⚠ A retry opens a second long-poll — never auto-retry this one.
        retries: 0,
        toolName: "channel_await",
    });
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
async function awaitWorkspaceMessages(t, opts) {
    const params = new URLSearchParams();
    params.set("since", String(opts.since));
    params.set("timeoutMs", String(opts.timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS));
    if (opts.excludeAuthor !== undefined) {
        params.set("excludeAuthor", opts.excludeAuthor);
    }
    return t.request(`/api/channels/await?${params.toString()}`, {
        method: "GET",
        timeoutMs: AWAIT_TIMEOUT_MS,
        // ⚠ A retry opens a second long-poll — never auto-retry this one.
        retries: 0,
        toolName: "channel_await_workspace",
    });
}
// ─── Write ──────────────────────────────────────────────────────────
async function createChannel(t, input) {
    const data = await t.request("/api/channels", {
        method: "POST",
        body: input,
        toolName: "channel_create",
    });
    return data.channel;
}
async function inviteToChannel(t, channelId, userId) {
    const data = await t.request(`/api/channels/${enc(channelId)}/members`, {
        method: "POST",
        body: { userId },
        toolName: "channel_invite",
    });
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
async function postMessage(t, channelId, input) {
    const data = await t.request(`/api/channels/${enc(channelId)}/messages`, { method: "POST", body: input, toolName: "channel_post" });
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
async function listChannelThreads(t, channelId) {
    const data = await t.request(`/api/channels/${enc(channelId)}/tasks`, { toolName: "channel_list_threads" });
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
async function listChannelSessions(t, channelId) {
    const query = channelId ? `?channelId=${enc(channelId)}` : "";
    const data = await t.request(`/api/channels/sessions${query}`, { toolName: "channel_read_sessions" });
    return data.sessions;
}
async function getChannelThread(t, channelId, threadId) {
    const data = await t.request(`/api/channels/${enc(channelId)}/tasks/${enc(threadId)}`, { toolName: "channel_get_thread" });
    return data.task;
}
async function createChannelThread(t, channelId, input) {
    const data = await t.request(`/api/channels/${enc(channelId)}/tasks`, {
        method: "POST",
        body: input,
        toolName: "channel_create_thread",
    });
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
async function setChannelThreadMode(t, channelId, threadId, input) {
    const data = await t.request(`/api/channels/${enc(channelId)}/tasks/${enc(threadId)}`, {
        method: "PATCH",
        body: { op: "set_mode", mode: input.mode },
        toolName: "channel_set_thread_mode",
    });
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
async function createLaunchDirective(t, input) {
    return t.request("/api/channels/launch-directives", {
        method: "POST",
        body: input,
        toolName: "channel_launch_agent",
    });
}
/**
 * POLL ONE DIRECTIVE — what a bounded hold reads while the desktop decides.
 *
 * ⚠ COARSE POLLING ONLY (1-2s). A directive lives at most two minutes and the
 * decision is a human-scale toggle plus a process spawn; polling faster buys
 * nothing and multiplies requests across every armed launch.
 * ⚠ Another operator's directive answers 404, indistinguishable from absent.
 */
async function getLaunchDirective(t, id) {
    const data = await t.request(`/api/channels/launch-directives/${enc(id)}`, { toolName: "channel_launch_poll" });
    return data.directive;
}
