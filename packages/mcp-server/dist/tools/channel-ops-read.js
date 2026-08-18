"use strict";
/**
 * `dopl_channel` READ op handlers: list, read, list_threads / get_thread,
 * members. All non-mutating, all ONE round-trip rendered. `await` lives in
 * `channel-ops-await.ts` (the only looping op).
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread` — the `thread`
 * op param resolves against `channel_tasks` rows and `/tasks` routes under
 * `@dopl/client`.
 *
 * Every STRING these ops emit lives in `channel-render.ts`, where the
 * peer-authored-text discipline is documented and enforced. This file is
 * control flow.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opList = opList;
exports.opRead = opRead;
exports.opReadSessions = opReadSessions;
exports.opListThreads = opListThreads;
exports.opGetThread = opGetThread;
exports.opMembers = opMembers;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
const channel_render_1 = require("./channel-render");
// ⚠ The clipped-list wording lives with the other thread-render prose, stated
// once — see INVARIANTS §9.
const channel_render_threads_1 = require("./channel-render-threads");
// ⚠ Addressing rule has ONE statement, in channel-addressing.ts.
const channel_addressing_1 = require("./channel-addressing");
/** Peer text that neutralized to nothing — never an empty span. */
const NO_ID = "(unreadable id)";
async function opList(client) {
    const channels = await client.listChannels();
    if (channels.length === 0) {
        return (0, respond_1.ok)('No channels yet. Create one with dopl_channel(op="open", name="...").');
    }
    const lines = [
        `## Channels — ${channels.length}\n`,
        // ⚠ Framing FIRST — member-typed names/topics, and a PUBLIC channel puts a
        // stranger's text before an agent that never opted into contact.
        `${channel_render_1.UNTRUSTED_LISTING_HEADER}\n`,
    ];
    for (const c of channels)
        lines.push((0, channel_render_1.formatChannelLine)(c));
    lines.push('\nRead a channel with dopl_channel(op="read", channel=<slug|id>); post with op="post"; watch for new messages with op="await".');
    return (0, respond_1.ok)(lines.join("\n"));
}
/**
 * Read a channel's transcript, optionally SCOPED TO ONE THREAD.
 *
 * ⚠ `thread` is a FILTER, not a lookup: route keeps rows whose
 * `metadata.taskId` equals it, an id nothing carries returns `[]` not 404, and
 * any non-empty string is legal (transcripts still carry legacy
 * `task-<channelId>-<seq>` ids). Blank/whitespace treated as unset rather than
 * sent, so `thread=""` reads the channel instead of 400ing on the route's `min(1)`.
 *
 * ⚠ `await` has no thread parameter — a filtered hold would miss messages an
 * agent must follow. Never suggest a thread-scoped wait here; the agent ends up
 * armed on a call that cannot exist.
 *
 * ⚠ NEITHER SEQ IS A CURSOR, so this hint offers NO number to await from. A safe
 * `since` is the highest seq below which the reader has seen EVERYTHING
 * channel-wide; a thread-scoped read deliberately filtered rows out and
 * establishes no such bound. `await` is `gt("seq", since)`, so a LARGER `since`
 * returns FEWER messages: awaiting from the channel-wide max drops every row in
 * `(threadMax, channelMax]` permanently, since the cursor only moves forward.
 */
async function opRead(client, ref, since, limit, selfUserId = null, thread) {
    const scope = thread?.trim() ? thread.trim() : undefined;
    // ⚠ Id ROUND TRIPS: agent copies it from a `read` legend, and a legend id is
    // `metadata.taskId`, stored verbatim by a peer for any non-UUID value. A
    // hand-built code span is not a container (one backtick opens it).
    const safeScope = scope ? (0, channel_shared_1.inlineOr)(scope, NO_ID) : "";
    // Hot path — no pre-resolve. Route accepts slug-or-id in [channelId] and
    // enforces visibility itself, so skip the per-call listChannels() round-trip.
    let messages;
    try {
        messages = await client.readChannelMessages(ref, {
            since,
            limit,
            thread: scope,
        });
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(ref);
        throw e;
    }
    const watch = `dopl_channel(op="await", channel="${ref}", since=`;
    if (messages.length === 0) {
        const sinceNote = since !== undefined ? ` after seq ${since}` : "";
        if (scope) {
            return (0, respond_1.ok)(`No messages tagged with thread ${safeScope} in **${ref}**${sinceNote}. \`thread\` FILTERS the transcript — an id no message carries comes back empty rather than as an error — so check the id with dopl_channel(op="list_threads", channel="${ref}") before you conclude the exchange is silent, or drop \`thread\` to read the whole channel. Watch for new messages with ${watch}${since ?? 0}); await is channel-wide and takes no thread.`);
        }
        return (0, respond_1.ok)(`No messages in **${ref}**${sinceNote}. Watch for new ones with ${watch}${since ?? 0}).`);
    }
    const count = `${messages.length} message${messages.length === 1 ? "" : "s"}`;
    const lines = [
        scope
            ? `## ${ref} — ${count} in thread ${safeScope} (ONE exchange, not the whole channel)\n`
            : `## ${ref} — ${count}\n`,
        // ⚠ Framing FIRST — a caveat under counterparty bodies is read after the
        // injected line it warns about.
        `${channel_render_1.UNTRUSTED_BODY_HEADER}\n`,
    ];
    // ⚠ No roster read here — hot path, the whole reason `read` skips `resolveChannelOr`.
    lines.push(...(0, channel_render_1.formatMessages)(messages, ref, selfUserId));
    const lastSeq = messages[messages.length - 1].seq;
    if (!scope) {
        // A channel-wide read already IS the channel-wide cursor.
        lines.push(`\nHighest seq shown: ${lastSeq}. Watch for newer messages with ${watch}${lastSeq}).`);
        return (0, respond_1.ok)(lines.join("\n"));
    }
    // ⚠ Thread-scoped read yields NO channel-wide cursor — offer no await number.
    lines.push(`\nHighest seq shown: ${lastSeq} — the highest in THIS thread, not in the channel. THIS READ DID NOT ADVANCE A CHANNEL-WIDE CURSOR, so do not await from ${lastSeq}: \`await\` is channel-wide with a strict "greater than", and this page deliberately left other exchanges out, so any number taken from it skips messages you have never seen — permanently, because the cursor only moves forward. Await from the highest seq below which you have seen EVERYTHING in this channel. If you do not have one, establish it first by reading the channel unscoped (drop \`thread\`) and awaiting from that page's last seq.`);
    return (0, respond_1.ok)(lines.join("\n"));
}
/** Peer-influenced display text (a session's channel name / thread title),
 *  neutralized for a rendered result — never an empty span. */
const NO_NAME = "(unnamed)";
const NO_TITLE = "(untitled)";
/**
 * READ-SESSION-STATE — the caller's OWN live sessions: handle, reduced state
 * (working / idle / ended — desktop `session-summary.js` vocabulary;
 * deliberately no "thinking", which needs streaming and streaming is off), and
 * thread. `ref` narrows to one channel; omitted = all in active workspace.
 *
 * ⚠ OWN-SCOPED is the whole security model: server read keys on the caller's
 * user id, RLS backs it, a peer's sessions never come back. Channel names and
 * thread titles are still counterparty-influenced, so they go through the same
 * inline-neutralizer under listing framing.
 *
 * Writer is `main/session-state-push.js` → `POST /api/channels/sessions`, fired
 * when the pill projection's digest moves (NOT a heartbeat).
 *
 * ⚠ The empty answer means "no live sessions being reported", never "you have
 * no sessions" — an asleep, signed-out, or older-build machine reports nothing.
 */
async function opReadSessions(client, ref) {
    // ⚠ Resolve filter to id — a slug would not match the stored channel_id.
    let channelId;
    let channelLabel = "";
    if (ref && ref.trim()) {
        const ch = await (0, channel_shared_1.resolveChannelOr)(client, ref.trim());
        if ((0, channel_shared_1.isErr)(ch))
            return ch;
        channelId = ch.id;
        channelLabel = ` in **${(0, channel_shared_1.inlineOr)(ch.name, NO_NAME)}**`;
    }
    const sessions = await client.listChannelSessions(channelId);
    if (sessions.length === 0) {
        return (0, respond_1.ok)(`No live sessions of yours are being reported${channelLabel} right now. This lists the sessions running on YOUR OWN machine (the agent windows your Dopl app opened), not another member's — to see what a PEER is doing, watch the thread you share with op="read" / op="await". If you expected a session here and see none, it may simply not be running, or your desktop has not reported its state yet.`);
    }
    const lines = [
        `## Your sessions — ${sessions.length}${channelLabel}\n`,
        // ⚠ Framing FIRST — channel names / thread titles below are
        // counterparty-influenced, same class as a channel listing's.
        `${channel_render_1.UNTRUSTED_LISTING_HEADER}\n`,
    ];
    for (const s of sessions)
        lines.push(formatSessionLine(s));
    lines.push(`\nEach line is one agent SESSION on your machine and its state: **working** (running tools now), **idle** (between turns, or waiting), **ended** (finished — its window is still open). To act on what a session is doing, open its window in the Dopl app; to reach the PEER a thread is with, post into that thread.`);
    return (0, respond_1.ok)(lines.join("\n"));
}
/**
 * ⚠ `state` is spliced into SERVER NARRATION, not a code span, so it must pass
 * a MEMBERSHIP test — a state carrying a newline could open a second
 * `_dopl_status` block. Its only other guards are the column's
 * `CHECK (state IN (…))` (in a migration NOT applied to the live database) and
 * an unchecked `as SessionPillState` in `collab-dto.ts`, so this is the layer
 * that actually holds. Membership, not neutralization: the set is closed and 3
 * long, so anything outside it is not a state we can render.
 */
const SESSION_STATES = new Set([
    "working",
    "idle",
    "ended",
]);
const UNKNOWN_STATE = "(unrecognized state)";
/** One session row, all peer-influenced text neutralized. */
function formatSessionLine(s) {
    const where = s.channelName ? ` · in ${(0, channel_shared_1.inlineOr)(s.channelName, NO_NAME)}` : "";
    const on = s.threadTitle
        ? ` · thread ${(0, channel_shared_1.inlineOr)(s.threadTitle, NO_TITLE)}`
        : s.threadId
            ? ` · thread ${(0, channel_shared_1.inlineOr)(s.threadId, NO_TITLE)}`
            : " · no thread";
    const state = SESSION_STATES.has(s.state) ? s.state : UNKNOWN_STATE;
    return `- **${(0, channel_shared_1.inlineOr)(s.name, NO_NAME)}** — ${state}${on}${where}`;
}
async function opListThreads(client, ref, selfUserId = null) {
    // Hot-path parity with read/await: ref straight to the route (slug-or-id +
    // visibility enforced there), no pre-resolve via listChannels.
    //
    // ⚠ THE ORDER IS THE SERVER'S AND IS NOT RE-DERIVED HERE. One repository read
    // (`repository-tasks.ts › listTasksByChannel`) orders every thread list by
    // last activity, so this listing and the operator's own sidebar cannot
    // disagree about which exchange is live. Sorting these rows again would also
    // be sorting the wrong rows — the server's LIMIT clipped against ITS order.
    let threads;
    let truncated;
    try {
        ({ threads, truncated } = await client.listChannelThreads(ref));
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(ref);
        throw e;
    }
    if (threads.length === 0) {
        return (0, respond_1.ok)(`No threads in **${ref}**. Open one with dopl_channel(op="create_thread", channel="${ref}", title="...", body="...", to="...").`);
    }
    const lines = [
        `## ${ref} — ${threads.length} thread${threads.length === 1 ? "" : "s"}, most recently active first\n`,
        // ⚠ Framing FIRST — titles/outcome summaries are peer-typed and
        // `listChannelTasks` is channel-transparent: every member receives every
        // thread's text, not just their own.
        `${channel_render_1.UNTRUSTED_THREAD_HEADER}\n`,
    ];
    // ⚠ The clip is stated ABOVE the rows, beside what it clipped — a reader who
    // skims to the first line must not read a bounded page as the whole list.
    if (truncated)
        lines.push(`${(0, channel_render_threads_1.threadsClippedNote)(ref)}\n`);
    // Extra call, but a cold op (not the poll loop) and fail-soft — see `memberNames`.
    const view = { selfUserId, names: await (0, channel_shared_1.memberNames)(client, ref) };
    for (const t of threads)
        lines.push((0, channel_render_1.formatThreadLine)(t, view));
    lines.push(`\nInspect one with dopl_channel(op="get_thread", channel="${ref}", thread=<id>); read its messages with op="read" (pass the same thread=<id> to see only that exchange). A thread accepts posts ONLY from the member who opened it and the member it is addressed to — everyone else in the channel can read it and is refused if they post into it.`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opGetThread(client, ref, threadId, selfUserId = null) {
    let thread;
    try {
        thread = await client.getChannelThread(ref, threadId);
    }
    catch (e) {
        // Route 404s both an unknown channel ref and a thread not in this channel;
        // surface a thread-oriented not-found either way.
        //
        // ⚠ `threadId` ROUND TRIPS (agent copies it from a `read` legend =
        // `metadata.taskId`, peer-stored verbatim for non-UUID values), so it needs
        // `inlineOr`. `ref` stays raw — caller's own argument, nothing
        // peer-authored reaches it.
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No thread ${(0, channel_shared_1.inlineOr)(threadId, NO_ID)} in **${ref}**. List a channel's threads with dopl_channel(op="list_threads", channel="${ref}").`);
        }
        throw e;
    }
    // ⚠ Framing FIRST, ABOVE the `## Thread <title>` heading — a waiting agent is
    // told to call this op every ~3 empty holds, so it re-reads a peer-typed
    // title on a timer.
    const view = { selfUserId, names: await (0, channel_shared_1.memberNames)(client, ref) };
    return (0, respond_1.ok)([channel_render_1.UNTRUSTED_THREAD_HEADER, ``, (0, channel_render_1.formatThreadDetail)(thread, view)].join("\n"));
}
/**
 * The channel ROSTER. Read-only; the private per-member preference (agent tool
 * profile) is scrubbed server-side for everyone but the caller and not rendered.
 *
 * ⚠ `callerIsAdmin` gates member EMAIL — a public channel is enumerable by an
 * agent that was never invited, so `formatMemberLine` shows email only for a
 * workspace admin or the caller's own row.
 */
async function opMembers(client, ref, selfUserId = null, callerIsAdmin = false) {
    let members;
    try {
        members = await client.listChannelMembers(ref);
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(ref);
        throw e;
    }
    if (members.length === 0) {
        return (0, respond_1.ok)(`No members visible in **${ref}**.`);
    }
    const lines = [
        `## ${ref} — ${members.length} member${members.length === 1 ? "" : "s"}\n`,
        `${channel_render_1.UNTRUSTED_ROSTER_HEADER}\n`,
    ];
    for (const m of members)
        lines.push((0, channel_render_1.formatMemberLine)(m, selfUserId, callerIsAdmin));
    if (selfUserId === null) {
        // ⚠ Never guess which row is the caller — the boot handshake is the only
        // source of that id here.
        lines.push(`\nNo row is marked "you" — this connection could not resolve your own user id at startup.`);
    }
    // ⚠ THERE USED TO BE TWO RULES HERE AND NOW THERE ARE NONE. Auto-addressing
    // keyed on `is_direct` (`resolveDirectPeer`) and the implicit trigger keyed on
    // MEMBER COUNT (`classify` in targeting.js); both retired 2026-08-18 (wiring
    // plan Phase 3). The count is still passed because the COPY names it — the
    // rule it states no longer branches on it. See `channel-addressing.ts`.
    lines.push((0, channel_addressing_1.rosterAddressingRule)(ref, members.length));
    return (0, respond_1.ok)(lines.join("\n"));
}
