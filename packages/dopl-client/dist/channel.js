"use strict";
/**
 * Channel methods for `DoplClient` — cross-user, agent-to-agent
 * collaboration threads. Free functions over `DoplTransport`; wired into
 * the `DoplClient` class in client.ts.
 *
 * `awaitMessages` is a LONG-POLL: the server holds the request open (up to
 * ~50s) waiting for a message with seq > since. It therefore uses a longer
 * network timeout and disables the transport's GET auto-retry — a retry
 * would open a second poll and could double-count arrivals.
 *
 * ONE call stays bounded at ~50s on purpose: the `/api/channels/[id]/await`
 * route's own maxDuration is 60s, so a longer single request would be killed
 * mid-flight. A multi-minute hold (the WAKE-V1 primitive) is assembled ABOVE
 * this layer, in the MCP `await` op, by re-issuing this call with the same
 * cursor — which keeps the retry ban meaningful: every re-issue is a
 * deliberate, cursor-preserving one, never a blind transport retry.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listChannels = listChannels;
exports.getChannel = getChannel;
exports.listChannelMembers = listChannelMembers;
exports.readMessages = readMessages;
exports.awaitMessages = awaitMessages;
exports.createChannel = createChannel;
exports.inviteToChannel = inviteToChannel;
exports.postMessage = postMessage;
exports.listChannelThreads = listChannelThreads;
exports.getChannelThread = getChannelThread;
exports.createChannelThread = createChannelThread;
exports.closeChannelThread = closeChannelThread;
exports.setChannelThreadMode = setChannelThreadMode;
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
    // Thread scope (optional): the server filters on `metadata.taskId`. Omitted
    // entirely when unset, so an older deployment sees the read it always saw.
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
        // A retry would open a second long-poll — never auto-retry this one.
        retries: 0,
        toolName: "channel_await",
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
 * Post a message. Resolves the STORED message plus the notices the write raised
 * — today just F6's `threadClosed`, which rides in the response ENVELOPE beside
 * the message (the shape `echoSeq` uses) rather than inside it.
 *
 * `threadClosed` is normalized to a boolean here, and that normalization is the
 * point: an older deployment sends no key, a post into an open thread sends no
 * key, and both must read as `false` rather than as `undefined` for the caller
 * to re-decide. Same additive-field discipline as {@link withParticipants}.
 */
async function postMessage(t, channelId, input) {
    const data = await t.request(`/api/channels/${enc(channelId)}/messages`, {
        method: "POST",
        body: input,
        toolName: "channel_post",
    });
    return { ...data.message, threadClosed: data.threadClosed === true };
}
// ─── Threads ────────────────────────────────────────────────────────
//
// BOUNDARY: wire/storage name `task` == domain name `thread`. The route
// segment (`/tasks`) and the response envelope keys (`tasks` / `task`) are
// STORAGE names and stay put — renaming them means a migration plus every
// read and write path. Everything above this line speaks `thread`.
/**
 * MULTIPLAYER: a thread READ now carries its PARTICIPANT SET — the breakout
 * room's membership. `withParticipants` is what makes the field safe to type
 * as non-optional: the server sends `[]` for a thread that has none, and an
 * OLDER deployment sends no field at all. Both must read as "no participants",
 * never as `undefined` for a caller to re-decide — the same additive-field
 * discipline `openingSeq` / `echoSeq` get below.
 */
function withParticipants(task) {
    const raw = task.participants;
    return { ...task, participants: Array.isArray(raw) ? raw : [] };
}
async function listChannelThreads(t, channelId) {
    const data = await t.request(`/api/channels/${enc(channelId)}/tasks`, { toolName: "channel_list_threads" });
    return data.tasks.map(withParticipants);
}
async function getChannelThread(t, channelId, threadId) {
    const data = await t.request(`/api/channels/${enc(channelId)}/tasks/${enc(threadId)}`, { toolName: "channel_get_thread" });
    return withParticipants(data.task);
}
async function createChannelThread(t, channelId, input) {
    const data = await t.request(`/api/channels/${enc(channelId)}/tasks`, {
        method: "POST",
        body: input,
        toolName: "channel_create_thread",
    });
    // `openingSeq` is additive on the route (WAKE-V1) — an older deployment
    // simply omits it, which reads as null here and makes the caller fall back to
    // looking the cursor up itself rather than arming `await` on `undefined`.
    return {
        thread: data.task,
        openingSeq: typeof data.openingSeq === "number" ? data.openingSeq : null,
    };
}
async function closeChannelThread(t, channelId, threadId, input) {
    const data = await t.request(`/api/channels/${enc(channelId)}/tasks/${enc(threadId)}`, {
        method: "PATCH",
        body: { op: "close", outcome: input.outcome, summary: input.summary },
        toolName: "channel_close_thread",
    });
    // `echoSeq` is additive on the route, exactly like `openingSeq` on create —
    // an older deployment omits it, which reads as null and tells the caller to
    // look its cursor up rather than arm `await` on a guess.
    return {
        thread: data.task,
        echoSeq: typeof data.echoSeq === "number" ? data.echoSeq : null,
    };
}
async function setChannelThreadMode(t, channelId, threadId, input) {
    const data = await t.request(`/api/channels/${enc(channelId)}/tasks/${enc(threadId)}`, {
        method: "PATCH",
        body: { op: "set_mode", mode: input.mode },
        toolName: "channel_set_thread_mode",
    });
    return data.task;
}
