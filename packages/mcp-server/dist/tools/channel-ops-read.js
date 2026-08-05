"use strict";
/**
 * `dopl_channel` READ op handlers: list (channels), read (messages),
 * list_threads / get_thread, members. All non-mutating, and all of them ONE
 * round-trip rendered.
 *
 * `await` used to live here and now has its own module,
 * `channel-ops-await.ts` — split at the §2 500-line cap when `read` gained its
 * `thread` filter, on the seam this file had already drawn twice
 * (`channel-await-budget.ts` took the clocks, `channel-wake-guidance.ts` the
 * wake claims). It is the only op here that loops, and nothing in it was shared
 * with these beyond the renderers.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread` — the
 * `thread` op param still resolves against `channel_tasks` rows and the
 * `/tasks` routes underneath `@dopl/client`.
 *
 * Every STRING these ops emit — the author labels, the thread renders, the
 * channel lines, and the untrusted-content headers that frame them — lives in
 * `channel-render.ts`. That split is where the peer-authored-text discipline is
 * documented and enforced (Q1); this file is control flow.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opList = opList;
exports.opRead = opRead;
exports.opListThreads = opListThreads;
exports.opGetThread = opGetThread;
exports.opMembers = opMembers;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
const channel_render_1 = require("./channel-render");
// Whether anything in a page names an AGENT — the predicate that keeps the
// roster read off the hot path (BLOCKER-3).
const channel_render_agents_1 = require("./channel-render-agents");
// The addressing rule has ONE statement, in one module — see
// channel-addressing.ts for what each half of it is verified against.
const channel_addressing_1 = require("./channel-addressing");
// Breakout-room membership: the set a thread read now carries, and the handles
// that name the agents in it. Both fail soft.
const channel_agent_refs_1 = require("./channel-agent-refs");
/** Peer text that neutralized to nothing — never an empty span. */
const NO_ID = "(unreadable id)";
async function opList(client) {
    const channels = await client.listChannels();
    if (channels.length === 0) {
        return (0, respond_1.ok)('No channels yet. Create one with dopl_channel(op="open", name="...").');
    }
    const lines = [
        `## Channels — ${channels.length}\n`,
        // Q1-A: framing FIRST. This listing renders member-typed names and topics,
        // and a PUBLIC channel puts a stranger's text in front of an agent that
        // never opted into contact with them — in the op the tool description tells
        // it to start with.
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
 * `thread` is a FILTER, not a lookup, and every string below is written from
 * that fact: the route keeps only the rows whose `metadata.taskId` equals it,
 * an id nothing carries returns `[]` rather than a 404, and any non-empty
 * string is legal — a thread id is a `channel_tasks` uuid today, but the
 * transcript still carries legacy `task-<channelId>-<seq>` ids and those are
 * the exchanges hardest to reconstruct by hand. Blank/whitespace is treated as
 * unset rather than sent, so a caller that passes `thread=""` gets the channel
 * read it meant instead of a 400 from the route's `min(1)`.
 *
 * WHAT THE FILTERED RESULT MAY NOT SAY: `await` has no thread parameter and
 * never will have one silently (a filtered hold would miss the messages an
 * agent must follow — see `channel-ops-await.ts`). So the seq this reports is
 * this THREAD's high-water mark, not the channel's, and the watch hint it hands
 * back is a plain channel-wide await. Suggesting a thread-scoped wait here is
 * how an agent ends up armed on a call that cannot exist.
 *
 * P1-8 (2026-08-04) SHIPPED THE FIX BACKWARDS, AND P1-8b (2026-08-05) UNDOES IT.
 *
 * The original complaint was real: the line said "Highest seq shown: N", warned
 * that N is thread-local, then interpolated that same N into `since=N`, so an
 * agent that had only ever read this thread never saw the messages sitting below
 * N in other exchanges. P1-8 concluded the CHANNEL-wide max M was the right
 * number and shipped that. It is the wrong direction, and it makes the loss
 * strictly worse.
 *
 * `await` is `gt("seq", since)`. A LARGER `since` returns FEWER messages. The
 * rows in `(N, M]` are precisely the other exchanges' messages this reader has
 * NOT seen: awaiting from N DELIVERS them, awaiting from M DROPS them — forever,
 * because the cursor only moves forward. P1-8 therefore caused the exact message
 * loss its own docblock was written to prevent, and its hint said so out loud
 * ("passing the thread-local N would skip everything between the two"), which is
 * the claim inverted. Caught in production by a counterparty's agent reading the
 * hint against the schema, in the exchange that was testing this feature.
 *
 * THE HONEST ANSWER IS THAT NEITHER NUMBER IS A CURSOR. A safe `since` is the
 * highest seq below which this reader has seen EVERYTHING, channel-wide; a
 * thread-scoped read establishes no such bound and cannot, because it deliberately
 * filtered rows out. So this hint no longer offers a number to await from. It
 * states the thread's high-water mark for display, says plainly that the read did
 * not advance any channel-wide cursor, and points at the two calls that CAN
 * establish one. The real fix is a thread filter on `await` (or an opaque resume
 * token) so "watch MY exchange" becomes expressible instead of approximated —
 * tracked as the elevation this incident argues for.
 */
async function opRead(client, ref, since, limit, selfUserId = null, thread) {
    const scope = thread?.trim() ? thread.trim() : undefined;
    // Q1-E — the id ROUND TRIPS: an agent copies it out of a `read` legend, and a
    // legend id is `metadata.taskId`, which a peer stores verbatim for any
    // non-UUID value. A hand-built code span is not a container (one backtick in
    // the value opens it), so it goes through the same helper as its siblings.
    const safeScope = scope ? (0, channel_shared_1.inlineOr)(scope, NO_ID) : "";
    // Hot path — no pre-resolve. The route accepts slug-or-id in the
    // [channelId] segment and enforces visibility itself, so we hand it the
    // caller's ref directly and skip a per-call listChannels() round-trip. A
    // route 404 (unknown ref, or one the caller can't see) maps to a clean
    // not-found; the ref stands in for the channel name in the output.
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
        // Framing FIRST — this listing renders counterparty-authored bodies, and a
        // caveat placed under them is read after the injected line it warns about.
        `${channel_render_1.UNTRUSTED_BODY_HEADER}\n`,
    ];
    // BLOCKER-3 — the handles for any agents these messages ADDRESS. Fetched
    // ONLY when something in the page actually names one, so an ordinary
    // transcript (and the poll loop behind it) pays nothing: this is the hot
    // path, and the whole reason `read` skips `resolveChannelOr`. Fails soft —
    // an unreadable roster renders the ids bare, never an error.
    const agentNames = (0, channel_render_agents_1.anyAgentAddressed)(messages)
        ? (await (0, channel_agent_refs_1.agentAddressIndex)(client, ref, selfUserId)).names
        : undefined;
    lines.push(...(0, channel_render_1.formatMessages)(messages, ref, selfUserId, agentNames));
    const lastSeq = messages[messages.length - 1].seq;
    if (!scope) {
        // A channel-wide read already IS the channel-wide cursor.
        lines.push(`\nHighest seq shown: ${lastSeq}. Watch for newer messages with ${watch}${lastSeq}).`);
        return (0, respond_1.ok)(lines.join("\n"));
    }
    // P1-8b — a thread-scoped read yields NO channel-wide cursor, so it offers no
    // number to await from. See the docblock: the thread max under-counts and the
    // channel max over-counts, and only the second one loses messages.
    lines.push(`\nHighest seq shown: ${lastSeq} — the highest in THIS thread, not in the channel. THIS READ DID NOT ADVANCE A CHANNEL-WIDE CURSOR, so do not await from ${lastSeq}: \`await\` is channel-wide with a strict "greater than", and this page deliberately left other exchanges out, so any number taken from it skips messages you have never seen — permanently, because the cursor only moves forward. Await from the highest seq below which you have seen EVERYTHING in this channel. If you do not have one, establish it first by reading the channel unscoped (drop \`thread\`) and awaiting from that page's last seq.`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opListThreads(client, ref, selfUserId = null) {
    // Hot-path parity with read/await: hand the ref straight to the route
    // (slug-or-id + visibility enforced there) and map a 404 to a clean
    // not-found, rather than pre-resolving via listChannels.
    let threads;
    try {
        threads = await client.listChannelThreads(ref);
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
        `## ${ref} — ${threads.length} thread${threads.length === 1 ? "" : "s"}\n`,
        // Q1-B: framing FIRST. Titles and outcome summaries below are peer-typed,
        // and `listChannelTasks` is channel-transparent — every member of the
        // channel receives every thread's text, not just their own.
        `${channel_render_1.UNTRUSTED_THREAD_HEADER}\n`,
    ];
    // Names for the two ids on every thread line. One extra call, on a cold op
    // (not the poll loop), and fail-soft — see `memberNames`.
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
        // The route 404s both an unknown channel ref and a thread not in this
        // channel; surface a thread-oriented not-found either way.
        //
        // Q1-E — `threadId` is the caller's own argument, but unlike `ref` it ROUND
        // TRIPS: an agent reads a thread id out of a `read` legend, and a legend id
        // is `metadata.taskId`, which a peer stores verbatim for any non-UUID value.
        // A hand-built code span is not a container — one backtick in the value
        // opens it — so it goes through the same helper as its siblings in
        // `channel-ops-threads.ts`. `ref` stays raw: it is the channel argument the
        // caller just passed and nothing peer-authored reaches it.
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No thread ${(0, channel_shared_1.inlineOr)(threadId, NO_ID)} in **${ref}**. List a channel's threads with dopl_channel(op="list_threads", channel="${ref}").`);
        }
        throw e;
    }
    // Q1-C: framing FIRST, above the `## Thread <title>` heading rather than
    // under it. The product tells a waiting agent to call this op every ~3 empty
    // holds, so it is a peer-typed title an agent re-reads on a timer.
    const view = { selfUserId, names: await (0, channel_shared_1.memberNames)(client, ref) };
    // MULTIPLAYER — the PARTICIPANT SET, which is the fact this op exists to
    // answer for an agent under the law "act on your own room": a thread with a
    // set is a breakout room and the set is who may post into it. Rendered here
    // rather than inside `formatThreadDetail` because naming the agents in it
    // needs a roster the pure renderer has no way to fetch. Both lookups fail
    // soft — an unreadable roster degrades to ids, never to an error.
    const agentNames = await (0, channel_agent_refs_1.agentNamesById)(client, ref);
    return (0, respond_1.ok)([
        channel_render_1.UNTRUSTED_THREAD_HEADER,
        ``,
        (0, channel_render_1.formatThreadDetail)(thread, view),
        ...(0, channel_agent_refs_1.participantLines)(thread.participants, view, agentNames),
    ].join("\n"));
}
/**
 * The channel ROSTER — who is actually in here.
 *
 * The gap this closes: `op="list"` reported "5 members" and NOTHING in the tool
 * said who they were, while `post` and `create_thread` both require addressing a
 * specific member and an unaddressed ask in a 3+ member channel triggers nobody.
 * An agent could see that a channel was a group, could be told to address one
 * member, and had no op that would tell it which members existed.
 *
 * Read-only, and it renders exactly what the roster route returns — the private
 * per-member preferences (notify scope, agent tool profile) are already scrubbed
 * server-side for everyone but the caller, and none of them are rendered here.
 */
async function opMembers(client, ref, selfUserId = null) {
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
        lines.push((0, channel_render_1.formatMemberLine)(m, selfUserId));
    if (selfUserId === null) {
        // Never guess which row is the caller: the boot handshake is the only
        // source of that id here, and when it failed the honest answer is to say so.
        lines.push(`\nNo row is marked "you" — this connection could not resolve your own user id at startup.`);
    }
    // TWO rules, and they are NOT the same rule. AUTO-ADDRESSING keys on
    // `is_direct` (`resolveDirectPeer` stamps nothing without it), which this op
    // cannot see. The IMPLICIT TRIGGER on the receiving machine keys on the MEMBER
    // COUNT (`classify`, targeting.js:152) — which this op has just counted
    // exactly. The first version of this line collapsed the two and told a
    // two-member channel its unaddressed messages reach nobody; they reach the
    // only other member. `rosterAddressingRule` states each from what it knows.
    lines.push((0, channel_addressing_1.rosterAddressingRule)(ref, members.length));
    return (0, respond_1.ok)(lines.join("\n"));
}
