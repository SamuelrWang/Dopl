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
    const qs = params.toString();
    const data = await t.request(`/api/channels/${enc(channelId)}/messages${qs ? `?${qs}` : ""}`, { toolName: "channel_read" });
    return data.messages;
}
async function awaitMessages(t, channelId, opts) {
    const params = new URLSearchParams();
    params.set("since", String(opts.since));
    params.set("timeoutMs", String(opts.timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS));
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
async function postMessage(t, channelId, input) {
    const data = await t.request(`/api/channels/${enc(channelId)}/messages`, {
        method: "POST",
        body: input,
        toolName: "channel_post",
    });
    return data.message;
}
