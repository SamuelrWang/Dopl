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
const channel_framing_1 = require("./channel-framing");
// ⚠ The clipped-list wording lives with the other thread-render prose, stated
// once — see INVARIANTS §9.
const channel_render_threads_1 = require("./channel-render-threads");
// ⚠ Addressing rule has ONE statement, in channel-addressing.ts.
const channel_addressing_1 = require("./channel-addressing");
// ⚠ THE ONE LINE A READ RESULT SPENDS ON THE RULES. Every standing paragraph
// these ops used to close with is in `channel-doctrine.ts`, behind `op="help"`
// and the `dopl://doctrine/channels` resource.
const channel_doctrine_1 = require("./channel-doctrine");
// ⚠ The session LINE — staleness hedge + operator-only telemetry — has ONE
// statement, in channel-session-render.ts, shared with `await`'s session block.
const channel_session_render_1 = require("./channel-session-render");
const channel_session_table_1 = require("./channel-session-table");
/** Peer text that neutralized to nothing — never an empty span. */
const NO_ID = "(unreadable id)";
async function opList(client) {
    const channels = await client.listChannels();
    if (channels.length === 0) {
        return (0, respond_1.ok)('No channels yet. Create one with dopl_channel(op="open", name="...").');
    }
    // ⚠ NO PER-RESULT SECURITY BANNER (T11, 2026-09-02). The framing did not go
    // away — it moved to CHANNEL_DESCRIPTION's own SECURITY paragraph, which is
    // read at connection and covers every result this tool returns. It is
    // repeated here no longer because ~3k chars of identical banner on every
    // read/list/await is what the orchestrator loop actually pays.
    const lines = [`## Channels — ${channels.length}\n`];
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
 *
 * ⚠ SO A SCOPED READ PRINTS NO SEQ AT ALL (2026-08-22, Samuel's ruling). It used
 * to print `Highest seq shown: <n>` and then spend four sentences telling the
 * reader not to use `<n>` — a footgun wrapped in prose is still a footgun, and
 * the number is what survives a skim. The two options were "omit it" and "return
 * an explicitly safe `nextSince`"; the second is not available here, because the
 * only safe value is the caller's OWN prior channel-wide cursor and this op
 * cannot see it. Omitting is therefore not a lesser fix: there is no number this
 * read is entitled to hand back. ⚠ The message lines above still carry each
 * message's own `**#seq**`, so nothing is hidden — what is withheld is the
 * SUMMARY line that reads like a cursor.
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
    // ⚠ Banner moved to the tool DESCRIPTION (T11) — see opList.
    const lines = [
        scope
            ? `## ${ref} — ${count} in thread ${safeScope} (ONE exchange, not the whole channel)\n`
            : `## ${ref} — ${count}\n`,
    ];
    // ⚠ No roster read here — hot path, the whole reason `read` skips `resolveChannelOr`.
    lines.push(...(0, channel_render_1.formatMessages)(messages, ref, selfUserId));
    const lastSeq = messages[messages.length - 1].seq;
    if (!scope) {
        // A channel-wide read already IS the channel-wide cursor.
        lines.push(`\nHighest seq shown: ${lastSeq}. Watch for newer messages with ${watch}${lastSeq}).`);
        return (0, respond_1.ok)(lines.join("\n"));
    }
    // ⚠ Thread-scoped read yields NO channel-wide cursor — so it prints no
    // summary seq. See the docblock: naming the number and forbidding it in the
    // same sentence is what shipped, and the number is what got used.
    // ⚠ THE ONE SENTENCE THAT MAY NOT SHRINK TO A TOKEN. `cursor=none` alone reads
    // as "this page has no cursor yet", and the agent then takes the highest
    // `**#seq**` off a message row — which is exactly the footgun. WHY there is no
    // cursor is the whole content: a larger `since` returns FEWER messages, so a
    // seq from a FILTERED page silently and permanently drops every row the filter
    // hid. One line, and the remedy is in it.
    lines.push(`\ncursor=none — \`thread\` filtered rows out of this page, and \`await\` is channel-wide with a strict "greater than", so a seq taken from here would permanently skip what the filter hid. Await from the highest seq below which you have seen EVERYTHING in this channel; read unscoped to establish one.`);
    return (0, respond_1.ok)(lines.join("\n"));
}
/** Peer-influenced display text (a session's channel name), neutralized for a
 *  rendered result — never an empty span. */
const NO_NAME = "(unnamed)";
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
 *
 * ⚠ AND THE SAME CAVEAT NOW APPLIES ROW BY ROW (2026-08-22). A row is a REPORT,
 * not an observation: nothing on the server watches the machine, so a desktop
 * that CRASHED leaves its last push standing and this op read it back as a live
 * `working` forever. `channel-session-render.ts` hedges any row quiet longer
 * than `SESSION_STALE_WINDOW_MS` into "last reported <state>" and the legend
 * says what that means. The stamp is NOT a heartbeat, so the hedge is a hedge
 * and never a claim the agent stopped.
 *
 * ⚠ THE TELEMETRY IS OPERATOR-ONLY, and this op is entitled to it because the
 * server read is own-scoped — `GET /api/channels/sessions` maps through
 * `collab-dto.ts › mapOwnSessionStateRow`. A peer's session reaches no surface
 * in this file.
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
    // ⚠ THE PAGE, NOT AN ARRAY (2026-08-23, F-294). `operatorOnline` is the
    // caller's own `agent_presence` freshness and it is what separates an
    // idle-but-alive agent from a desktop that died — the row alone cannot,
    // because the push is change-driven. ⚠ `undefined` = an older server did not
    // report it, and the render must hedge exactly as it did before.
    const { sessions, operatorOnline } = await client.listChannelSessions(channelId);
    if (sessions.length === 0) {
        return (0, respond_1.ok)(
        // ⚠ "BEING REPORTED" IS THE LOAD-BEARING PHRASE and may never become "you
        // have none": an asleep, signed-out or older machine reports nothing, so
        // an empty page is not evidence a session is not running. The rest — that
        // this is your own side only — is in the doctrine.
        `No live sessions of yours are being REPORTED${channelLabel} right now. That is not the same as having none: an asleep, signed-out or older machine reports nothing. ${channel_doctrine_1.DOCTRINE_POINTER}`);
    }
    // ⚠ ONE `now` FOR THE WHOLE PAGE. Calling `Date.now()` per line lets two
    // sessions pushed in the same instant land on either side of the window and
    // render with different tenses, which reads as a fact about them.
    const now = Date.now();
    const anyStale = sessions.some((s) => (0, channel_session_render_1.sessionIsStale)(s, now));
    // ⚠ A TABLE, AND ONLY A TABLE (T13, 2026-09-02). Banner moved to the tool
    // DESCRIPTION (T11) — see opList.
    //
    // ⚠ WHAT LEFT, AND WHY IT IS NOT A LOSS. This result used to close with three
    // standing paragraphs — the legend, SESSION_HANDLE_NOTE (~1.1k chars on how a
    // handle is spent) and SESSION_TELEMETRY_NOTE (~800) — on EVERY call, to a
    // reader who calls this op in a loop. The legend stays, because it is the one
    // that decodes THIS page's own cells and it is conditional on the page
    // actually containing a hedged row. The other two are standing DOCTRINE about
    // the surface rather than a report on these rows: they moved to
    // dopl://doctrine/channels and dopl_channel(op="help"), which is where a
    // reader who needs them can spend one call, instead of every reader paying
    // for them on every call.
    const lines = [
        `## Your sessions — ${sessions.length}${channelLabel}\n`,
        ...channel_session_table_1.SESSION_TABLE_HEAD,
    ];
    for (const s of sessions) {
        // ⚠ `handle: true` — this op is own-scoped by construction (it "never shows
        // a PEER's sessions"), which is the audience question
        // {@link SessionRenderOpts.handle} asks. See it for why an agent id is not
        // published on a peer row.
        lines.push((0, channel_session_table_1.sessionRow)(s, { telemetry: true, handle: true, now, operatorOnline }));
    }
    // ⚠ THE LEGEND STAYS AND THE POINTER IS ONE LINE. The legend decodes THIS
    // page's own cells and is conditional on the page actually containing a hedged
    // row; the standing description of the columns (which are operator-only, what
    // a `—` means, why a row is a REPORT and not an observation) is doctrine and
    // is read once, not on every call of an op an orchestrator polls in a loop.
    lines.push(`\n${(0, channel_session_render_1.sessionLegend)(anyStale, operatorOnline)} ${channel_doctrine_1.DOCTRINE_POINTER}`);
    return (0, respond_1.ok)(lines.join("\n"));
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
        `${channel_framing_1.UNTRUSTED_THREAD_HEADER}\n`,
    ];
    // ⚠ The clip is stated ABOVE the rows, beside what it clipped — a reader who
    // skims to the first line must not read a bounded page as the whole list.
    if (truncated)
        lines.push(`${(0, channel_render_threads_1.threadsClippedNote)(ref)}\n`);
    // Extra call, but a cold op (not the poll loop) and fail-soft — see `memberNames`.
    const view = { selfUserId, names: await (0, channel_shared_1.memberNames)(client, ref) };
    for (const t of threads)
        lines.push((0, channel_render_1.formatThreadLine)(t, view));
    // ⚠ ONE POINTER LINE (T11/T82, 2026-09-02). The pair-only WRITE RULE that used
    // to close this listing is standing doctrine — true of every thread in every
    // channel — and is stated in `channel-doctrine.ts` under THE MODEL. What stays
    // is the two calls a reader of THIS page needs next.
    lines.push(`\nRead one with op="read" (thread=<id>); inspect it with op="get_thread". ${channel_doctrine_1.DOCTRINE_POINTER}`);
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
    return (0, respond_1.ok)([channel_framing_1.UNTRUSTED_THREAD_HEADER, ``, (0, channel_render_1.formatThreadDetail)(thread, view)].join("\n"));
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
        `${channel_framing_1.UNTRUSTED_ROSTER_HEADER}\n`,
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
