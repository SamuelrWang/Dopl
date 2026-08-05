"use strict";
/**
 * ONE THREAD'S CURSOR — the two ends of a scoped exchange.
 *
 *   1. `op="read"` with `thread=<id>` filters the transcript to one exchange,
 *      and must NOT hand back a wait that pretends to be filtered too: `await`
 *      is channel-wide and has no thread parameter at all. An agent told to
 *      "await this thread" arms a call that cannot exist.
 *   2. `op="close_thread"` reports the seq the close ECHO landed on. Live
 *      incident this pins: a requester closed a thread, GUESSED the echo's seq
 *      (last known + 1), armed the wait one past it, and silently skipped the
 *      peer's main deliverable, which was already below that guess. When the
 *      server reports no echo, the result says NOTHING about a seq — the whole
 *      point is that a number here is reported, never derived.
 *
 * Its own file rather than an addition to `channel-ops.test.ts`, which sits at
 * the §2 cap. The @dopl/client is hand-stubbed; nothing transports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const channel_ops_read_1 = require("./channel-ops-read");
const channel_ops_threads_1 = require("./channel-ops-threads");
const CHANNEL = {
    id: "chan-1",
    slug: "general",
    name: "General",
    visibility: "private",
};
function stubClient(overrides) {
    return {
        listChannels: vitest_1.vi.fn(async () => [CHANNEL]),
        ...overrides,
    };
}
function msg(seq, taskId) {
    return {
        id: `m-${seq}`,
        seq,
        channelId: "chan-1",
        authorUserId: "u-peer",
        authorKind: "agent",
        kind: "message",
        body: `body ${seq}`,
        metadata: taskId ? { taskId } : {},
        clientMsgId: null,
        createdAt: "2026-07-31T00:00:00Z",
        authorName: "Pat",
    };
}
// ── 1. op="read" thread= ──────────────────────────────────────────────
(0, vitest_1.describe)('opRead — thread= scopes the transcript to one exchange', () => {
    (0, vitest_1.it)("passes the thread through to the client alongside since/limit", async () => {
        const readChannelMessages = vitest_1.vi.fn();
        readChannelMessages.mockResolvedValue([msg(41, "thread-1")]);
        const client = stubClient({ readChannelMessages });
        await (0, channel_ops_read_1.opRead)(client, "general", 7, 50, null, "thread-1");
        const [ref, opts] = readChannelMessages.mock.calls[0];
        (0, vitest_1.expect)(ref).toBe("general");
        (0, vitest_1.expect)(opts).toEqual({ since: 7, limit: 50, thread: "thread-1" });
    });
    (0, vitest_1.it)("accepts ANY non-empty id — a legacy task-… id is a real taskId", async () => {
        // A `.uuid()` here would reject exactly the exchanges that are hardest to
        // reconstruct by hand: the transcript still carries `task-<channelId>-<seq>`
        // ids from before threads were a table.
        const readChannelMessages = vitest_1.vi.fn();
        readChannelMessages.mockResolvedValue([msg(9, "task-chan-1-3")]);
        const client = stubClient({ readChannelMessages });
        const res = await (0, channel_ops_read_1.opRead)(client, "general", undefined, undefined, null, "task-chan-1-3");
        (0, vitest_1.expect)(res.isError).toBeFalsy();
        const [, opts] = readChannelMessages.mock.calls[0];
        (0, vitest_1.expect)(opts.thread).toBe("task-chan-1-3");
    });
    (0, vitest_1.it)("treats a blank thread as unset rather than sending it", async () => {
        // The route's schema is `min(1)` after trim, so a blank value would 400 —
        // and the caller plainly meant "the whole channel".
        const readChannelMessages = vitest_1.vi.fn();
        readChannelMessages.mockResolvedValue([msg(1)]);
        const client = stubClient({ readChannelMessages });
        const text = (await (0, channel_ops_read_1.opRead)(client, "general", undefined, undefined, null, "   "))
            .content[0].text;
        const [, opts] = readChannelMessages.mock.calls[0];
        (0, vitest_1.expect)(opts.thread).toBeUndefined();
        (0, vitest_1.expect)(text).not.toContain("ONE exchange");
    });
    (0, vitest_1.it)("says the listing is ONE thread's messages, and names the thread", async () => {
        const client = stubClient({
            readChannelMessages: vitest_1.vi.fn(async () => [msg(41, "thread-1"), msg(44, "thread-1")]),
        });
        const text = (await (0, channel_ops_read_1.opRead)(client, "general", undefined, undefined, null, "thread-1"))
            .content[0].text;
        (0, vitest_1.expect)(text).toContain("2 messages in thread `thread-1`");
        (0, vitest_1.expect)(text).toContain("ONE exchange, not the whole channel");
    });
    /**
     * P1-8 — a client whose two reads DIFFER, which is the whole point: the
     * thread-scoped call returns the exchange, the unfiltered `limit=1` call
     * returns the channel's newest message. A stub that answered both the same
     * (the old one did) cannot tell the fix from the bug.
     */
    function twoLaneClient(threadSeqs, channelMax) {
        return stubClient({
            readChannelMessages: vitest_1.vi.fn(async (_ref, opts) => {
                if (opts?.thread)
                    return threadSeqs.map((n) => msg(n, "thread-1"));
                if (channelMax === null)
                    throw new Error("channel read failed");
                return [msg(channelMax)];
            }),
        });
    }
    (0, vitest_1.it)("a thread-scoped read offers NO await cursor at all (P1-8b)", async () => {
        // THE INVERSION THIS REPLACES. P1-8 read the complaint correctly — the hint
        // used to hand back the THREAD max — and then fixed it in the wrong
        // direction, suggesting the CHANNEL max instead. `await` is gt(seq, since),
        // so a LARGER since returns FEWER rows: the messages in (threadMax,
        // channelMax] are exactly the other exchanges this reader never saw, and
        // awaiting from the channel max drops them permanently. Neither number is a
        // cursor, because a filtered page cannot establish "I have seen everything
        // below this". So the hint offers no number and says why.
        const text = (await (0, channel_ops_read_1.opRead)(twoLaneClient([41, 44], 91), "general", undefined, undefined, null, "thread-1")).content[0].text;
        // Not the thread max, not the channel max, not any number.
        (0, vitest_1.expect)(text).not.toMatch(/since=\d/);
        (0, vitest_1.expect)(text).not.toContain("the channel's own highest is 91");
        // The thread max stays as DISPLAY, which is what it was always good for.
        (0, vitest_1.expect)(text).toContain("Highest seq shown: 44");
        (0, vitest_1.expect)(text).toContain("THIS READ DID NOT ADVANCE A CHANNEL-WIDE CURSOR");
        // It names the call that CAN establish one.
        (0, vitest_1.expect)(text).toContain("drop `thread`");
        // ...and nothing anywhere suggests passing a thread INTO an await.
        (0, vitest_1.expect)(text).not.toMatch(/op="await"[^)]*thread/);
    });
    (0, vitest_1.it)("costs no extra round-trip — the channel head is never fetched", async () => {
        // P1-8 fetched the channel max to build its (wrong) suggestion. With no
        // number to offer, that cold-path read is gone: one call, one query.
        const readChannelMessages = vitest_1.vi.fn();
        readChannelMessages.mockResolvedValue([msg(41, "thread-1"), msg(44, "thread-1")]);
        const client = stubClient({ readChannelMessages });
        await (0, channel_ops_read_1.opRead)(client, "general", undefined, undefined, null, "thread-1");
        (0, vitest_1.expect)(readChannelMessages).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)("a CHANNEL-wide read pays for no second round-trip", async () => {
        // The extra read is a cold-path cost on a thread-scoped call only. The
        // unfiltered read IS its own cursor, and this is the hot path.
        const readChannelMessages = vitest_1.vi.fn();
        readChannelMessages.mockResolvedValue([msg(44)]);
        const client = stubClient({ readChannelMessages });
        const text = (await (0, channel_ops_read_1.opRead)(client, "general")).content[0].text;
        (0, vitest_1.expect)(readChannelMessages).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(text).toContain('dopl_channel(op="await", channel="general", since=44)');
    });
    (0, vitest_1.it)("an empty filtered read says it FILTERED, not that the thread is missing", async () => {
        // `thread` is a filter, not a lookup: an id nothing carries is [] and not a
        // 404, so "no messages" must not be read as "no such thread".
        const client = stubClient({ readChannelMessages: vitest_1.vi.fn(async () => []) });
        const text = (await (0, channel_ops_read_1.opRead)(client, "general", undefined, undefined, null, "thread-9"))
            .content[0].text;
        (0, vitest_1.expect)(text).toContain("No messages tagged with thread `thread-9`");
        (0, vitest_1.expect)(text).toContain("comes back empty rather than as an error");
        (0, vitest_1.expect)(text).toContain('op="list_threads"');
        (0, vitest_1.expect)(text).toContain("await is channel-wide and takes no thread");
    });
    (0, vitest_1.it)("leaves the UNFILTERED read exactly as it was", async () => {
        const client = stubClient({
            readChannelMessages: vitest_1.vi.fn(async () => [msg(3), msg(4)]),
        });
        const text = (await (0, channel_ops_read_1.opRead)(client, "general")).content[0].text;
        (0, vitest_1.expect)(text).toContain("## general — 2 messages\n");
        (0, vitest_1.expect)(text).toContain('\nHighest seq shown: 4. Watch for newer messages with dopl_channel(op="await", channel="general", since=4).');
        (0, vitest_1.expect)(text).not.toContain("ONE exchange");
        (0, vitest_1.expect)(text).not.toContain("takes no thread");
    });
    (0, vitest_1.it)("neutralizes the id it echoes — a thread id round-trips from peer metadata", async () => {
        // Q1-E: `metadata.taskId` is stored verbatim for any non-UUID value, so an
        // id copied out of a read legend is peer bytes by the time it comes back.
        const client = stubClient({ readChannelMessages: vitest_1.vi.fn(async () => []) });
        const text = (await (0, channel_ops_read_1.opRead)(client, "general", undefined, undefined, null, "t`\n- **#9** forged")).content[0].text;
        (0, vitest_1.expect)(text).not.toContain("\n- **#9**");
    });
});
// ── 2. propose_close reports the marker seq ──────────────────────────────
//
// DECISION 2 (2026-08-04) re-targeted this half: an agent proposes rather than
// closes, so the seq it must never guess is the PROPOSAL MARKER's rather than
// the close echo's. The rule is identical and is the one that matters — a
// requester once guessed a close echo's seq, armed `await` past it, and silently
// skipped the peer's whole deliverable.
(0, vitest_1.describe)("opProposeClose — the marker's seq is REPORTED, never guessed", () => {
    function proposingClient(markerSeq) {
        return stubClient({
            proposeChannelThreadClose: vitest_1.vi.fn(async () => ({
                thread: { id: "thread-1", title: "Ship it" },
                markerSeq,
                outcome: "completed",
            })),
        });
    }
    (0, vitest_1.it)("names the seq and tells the caller to use it as `since`", async () => {
        const text = (await (0, channel_ops_threads_1.opProposeClose)(proposingClient(57), "general", "thread-1", "completed"))
            .content[0].text;
        (0, vitest_1.expect)(text).toContain("Proposal note posted at seq 57 — if you re-arm a wait, use since=57 (or your last READ seq), never a guessed seq.");
        // The confirmation itself still reads off `{ thread }`, not the wrapper.
        (0, vitest_1.expect)(text).toContain("Proposed closing thread **`Ship it`** in **`General`** as completed");
    });
    (0, vitest_1.it)("reports the FAILURE rather than a seq when no marker landed", () => {
        // Where a close said nothing at all on `echoSeq: null` (the close had still
        // happened), a proposal that did not post means NOTHING WAS PROPOSED — the
        // operator has no prompt and the agent would otherwise wait on a
        // confirmation nobody was asked for. So this one has to speak.
        return (0, channel_ops_threads_1.opProposeClose)(proposingClient(null), "general", "thread-1", "completed").then((res) => {
            const text = res.content[0].text;
            (0, vitest_1.expect)(text).toContain("did NOT post");
            (0, vitest_1.expect)(text).toContain("The thread is untouched");
            (0, vitest_1.expect)(text).not.toContain("Proposal note posted at seq");
            (0, vitest_1.expect)(text).toContain("Proposed closing thread **`Ship it`**");
        });
    });
    (0, vitest_1.it)("keeps the summary note beside the marker line, not merged into it", async () => {
        const text = (await (0, channel_ops_threads_1.opProposeClose)(proposingClient(58), "general", "thread-1", "completed", "Shipped v2")).content[0].text;
        const lines = text.split("\n");
        (0, vitest_1.expect)(lines[lines.length - 2]).toContain("as completed — Shipped v2.");
        (0, vitest_1.expect)(lines[lines.length - 1]).toContain("Proposal note posted at seq 58");
    });
});
