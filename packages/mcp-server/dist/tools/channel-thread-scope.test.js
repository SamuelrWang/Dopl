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
    (0, vitest_1.it)("never offers a thread-filtered wait — await has no thread parameter", async () => {
        const client = stubClient({
            readChannelMessages: vitest_1.vi.fn(async () => [msg(44, "thread-1")]),
        });
        const text = (await (0, channel_ops_read_1.opRead)(client, "general", undefined, undefined, null, "thread-1"))
            .content[0].text;
        // The re-arm hint is a plain channel await on the thread's high-water seq...
        (0, vitest_1.expect)(text).toContain('dopl_channel(op="await", channel="general", since=44)');
        // ...explicitly described as unfiltered, and the seq as this thread's own.
        (0, vitest_1.expect)(text).toContain("await is channel-wide and takes no thread");
        (0, vitest_1.expect)(text).toContain("the highest in THIS thread, not in the channel");
        // ...and nothing anywhere suggests passing a thread INTO an await.
        (0, vitest_1.expect)(text).not.toMatch(/op="await"[^)]*thread/);
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
// ── 2. close_thread reports the echo seq ──────────────────────────────
(0, vitest_1.describe)("opCloseThread — the close echo's seq is REPORTED, never guessed", () => {
    function closingClient(echoSeq) {
        return stubClient({
            closeChannelThread: vitest_1.vi.fn(async () => ({
                thread: { id: "thread-1", title: "Ship it", outcome: "completed" },
                echoSeq,
            })),
        });
    }
    (0, vitest_1.it)("names the seq and tells the caller to use it as `since`", async () => {
        const text = (await (0, channel_ops_threads_1.opCloseThread)(closingClient(57), "general", "thread-1", "completed"))
            .content[0].text;
        (0, vitest_1.expect)(text).toContain("Close echo posted at seq 57 — if you re-arm a wait, use since=57 (or your last READ seq), never a guessed seq.");
        // The confirmation itself still reads off `{ thread }`, not the wrapper.
        (0, vitest_1.expect)(text).toContain("Closed thread **`Ship it`** in **`General`** as completed");
    });
    (0, vitest_1.it)("says NOTHING about a seq when the server reported no echo", async () => {
        // null = an older deployment that omits the field, or a marker post that
        // failed. Both mean the same thing to a caller: do not derive a cursor.
        const text = (await (0, channel_ops_threads_1.opCloseThread)(closingClient(null), "general", "thread-1", "completed"))
            .content[0].text;
        (0, vitest_1.expect)(text).not.toContain("Close echo");
        (0, vitest_1.expect)(text).not.toContain("seq");
        (0, vitest_1.expect)(text).not.toContain("never a guessed seq");
        (0, vitest_1.expect)(text).toContain("Closed thread **`Ship it`**");
    });
    (0, vitest_1.it)("keeps the summary note beside the echo line, not merged into it", async () => {
        const text = (await (0, channel_ops_threads_1.opCloseThread)(closingClient(58), "general", "thread-1", "completed", "Shipped v2")).content[0].text;
        const lines = text.split("\n");
        (0, vitest_1.expect)(lines[lines.length - 2]).toContain("as completed — Shipped v2.");
        (0, vitest_1.expect)(lines[lines.length - 1]).toContain("Close echo posted at seq 58");
    });
});
