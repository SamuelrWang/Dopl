"use strict";
/**
 * F6 — CLOSING A THREAD STOPS ITS PASSIVE ROUTING; IT DOES NOT SEAL IT.
 *
 * The write path gated on thread MEMBERSHIP and never on thread STATUS, so a
 * thread closed at #355 accepted #356, #361, #362, #363 and #365 with no refusal
 * and no warning — while THIS tool's close result said "Closed thread <title> …
 * as <outcome>." and stopped, i.e. asserted a finality the server does not
 * enforce. Two halves, both pinned here:
 *
 *  1. the CLOSE result now says what closing really changes (the PASSIVE lane),
 *     and says outright that a later post is still accepted;
 *
 * THE SCOPE OF THAT CLAIM IS ITSELF PINNED, because the first correction
 * overshot: "no session is woken for it any more" is not true either. The
 * desktop skips the passive thread-lane wake off a status cache that lags by up
 * to ~5 minutes, an older build does not skip it at all, and an ADDRESSED post
 * starts its addressee whatever the status is. So both surfaces have to say
 * PASSIVE and have to leave addressing standing.
 *  2. the POST result carries the warning when the server reports the thread was
 *     closed — WARN, NEVER REFUSE. A 403 would break the legitimate "one last
 *     word after the close echo" pattern, and its remedy (reopen) has no op on
 *     this tool, so a refusal would point the agent at something it cannot do.
 *
 * The server half — that `threadClosed` is raised at all, and that the message
 * still lands — is pinned in
 * `src/features/channels/server/service-writes-metadata-closed.test.ts`.
 *
 * `opCloseThread`'s SUMMARY behaviour (Feature 3c) moved here from
 * `channel-ops.test.ts` in the same change — a §2 split at the 500-line cap, on
 * the seam that this file already is: every assertion about a close result now
 * lives in one place instead of two that would have to be re-worded together.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const channel_ops_write_1 = require("./channel-ops-write");
const channel_ops_threads_1 = require("./channel-ops-threads");
const channel_render_1 = require("./channel-render");
const CHANNEL = {
    id: "chan-1",
    slug: "general",
    name: "General",
    visibility: "private",
};
const THREAD_ID = "79ce5325-f53e-4d00-a1c0-f48875000bc0";
function stubClient(overrides) {
    return {
        listChannels: vitest_1.vi.fn(async () => [CHANNEL]),
        listChannelThreads: vitest_1.vi.fn(async () => []),
        ...overrides,
    };
}
/** The stored message a post resolves to, with the F6 notice on it. */
function posted(threadClosed) {
    return {
        id: "m1",
        seq: 356,
        kind: "message",
        authorUserId: "u-me",
        metadata: { taskId: THREAD_ID, taskTitle: "Wire the listener" },
        threadClosed,
    };
}
(0, vitest_1.describe)("opCloseThread — summary (Feature 3c)", () => {
    (0, vitest_1.it)("forwards `summary` to the client and surfaces it in the confirmation", async () => {
        const closeChannelThread = vitest_1.vi.fn();
        closeChannelThread.mockResolvedValue({
            thread: { title: "Ship it", outcome: "completed" },
            echoSeq: null,
        });
        const client = stubClient({ closeChannelThread });
        const res = await (0, channel_ops_threads_1.opCloseThread)(client, "general", "thread-uuid", "completed", "Shipped v2 to prod");
        const [channelId, threadId, input] = closeChannelThread.mock.calls[0];
        (0, vitest_1.expect)(channelId).toBe("chan-1");
        (0, vitest_1.expect)(threadId).toBe("thread-uuid");
        (0, vitest_1.expect)(input).toEqual({ outcome: "completed", summary: "Shipped v2 to prod" });
        (0, vitest_1.expect)(res.content[0].text).toContain("Shipped v2 to prod");
    });
    (0, vitest_1.it)("omits the summary note when none is given", async () => {
        const closeChannelThread = vitest_1.vi.fn();
        closeChannelThread.mockResolvedValue({
            thread: { title: "Ship it", outcome: "failed" },
            echoSeq: null,
        });
        const client = stubClient({ closeChannelThread });
        const res = await (0, channel_ops_threads_1.opCloseThread)(client, "general", "thread-uuid", "failed");
        const [, , input] = closeChannelThread.mock.calls[0];
        (0, vitest_1.expect)(input).toEqual({ outcome: "failed", summary: undefined });
        // Q1 (write sweep): the peer-typed title is a code span and the result now
        // opens with the thread header — a thread's TARGET may close it, so this
        // echo routinely renders a title the caller never wrote.
        //
        // F6 — the sentence CONTINUES past the outcome now, and what it adds is the
        // point: the old full stop after "as failed." asserted a finality the server
        // does not enforce (the post path never reads thread status, so a closed
        // thread goes on accepting posts). Pinned as a prefix + the routing claim,
        // rather than as the whole paragraph, so re-wording the teaching does not
        // fail a test about the confirmation.
        const text = res.content[0].text;
        (0, vitest_1.expect)(text.startsWith(`${channel_render_1.UNTRUSTED_THREAD_HEADER}\n\nClosed thread **\`Ship it\`** in **\`General\`** as failed.`)).toBe(true);
        (0, vitest_1.expect)(text).toContain("stops the thread's PASSIVE routing");
        (0, vitest_1.expect)(text).toContain("does NOT seal it");
        // …and it must not carry a summary note it was given none of: with a
        // summary the outcome is followed by " — <summary>", never by the period.
        (0, vitest_1.expect)(text).not.toContain("as failed — ");
    });
});
(0, vitest_1.describe)("opCloseThread — the close result stops claiming finality (F6)", () => {
    (0, vitest_1.it)("says the thread stops PASSIVE routing, and that a later post still lands", async () => {
        const closeChannelThread = vitest_1.vi.fn(async () => ({
            thread: { id: THREAD_ID, title: "Wire the listener", outcome: "completed" },
            echoSeq: 355,
        }));
        const client = stubClient({ closeChannelThread });
        const res = await (0, channel_ops_threads_1.opCloseThread)(client, "general", THREAD_ID, "completed");
        const text = res.content[0].text;
        (0, vitest_1.expect)(res.isError).toBeFalsy();
        // The confirmation itself is unchanged…
        (0, vitest_1.expect)(text).toContain("Closed thread **`Wire the listener`**");
        (0, vitest_1.expect)(text).toContain("as completed");
        // …and what follows it is the correction: passive routing, not sealing.
        (0, vitest_1.expect)(text).toContain("stops the thread's PASSIVE routing");
        (0, vitest_1.expect)(text).toContain("does NOT seal it");
        (0, vitest_1.expect)(text).toContain("still accepts posts");
        // The claim is SCOPED: it must not promise a silence nothing enforces, so
        // direct addressing is left standing in the same breath.
        (0, vitest_1.expect)(text).toContain("address directly still hears you");
        // And the one action the agent cannot take here is named as a human's.
        (0, vitest_1.expect)(text).toContain("Reopening is a human's action in the web app");
        // The echo seq still rides out — never a guessed cursor.
        (0, vitest_1.expect)(text).toContain("Close echo posted at seq 355");
    });
});
(0, vitest_1.describe)("opPost — the closed-thread warning (F6)", () => {
    (0, vitest_1.it)("returns the warning when the server reports the thread was closed", async () => {
        const postChannelMessage = vitest_1.vi.fn(async () => posted(true));
        const client = stubClient({ postChannelMessage });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "one last thing", {
            thread: THREAD_ID,
        });
        const text = res.content[0].text;
        // NOT an error: the post landed, and the result has to say that first.
        (0, vitest_1.expect)(res.isError).toBeFalsy();
        (0, vitest_1.expect)(text).toContain("Posted to **`General`**");
        (0, vitest_1.expect)(text).toContain("THAT THREAD IS CLOSED");
        (0, vitest_1.expect)(text).toContain("the post landed anyway");
        (0, vitest_1.expect)(text).toContain("stops the thread's PASSIVE routing");
        // The warning tells the agent to stop expecting an UNPROMPTED reply, and
        // NOT that the thread has gone silent: the thread still takes posts, and
        // addressing somebody still starts them.
        (0, vitest_1.expect)(text).toContain("does NOT stop the thread accepting posts");
        (0, vitest_1.expect)(text).toContain('to_agent="<handle>" starts that agent');
        // It points at the action the agent CAN take, and says plainly that the
        // other one is a human's — this tool has no reopen op.
        (0, vitest_1.expect)(text).toContain('dopl_channel(op="create_thread", channel="chan-1"');
        (0, vitest_1.expect)(text).toContain("this tool has no reopen op");
    });
    (0, vitest_1.it)("says nothing at all when the thread is open", async () => {
        const postChannelMessage = vitest_1.vi.fn(async () => posted(false));
        const client = stubClient({ postChannelMessage });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "still working", {
            thread: THREAD_ID,
        });
        (0, vitest_1.expect)(res.content[0].text).not.toContain("THAT THREAD IS CLOSED");
    });
    (0, vitest_1.it)("says nothing when the field is absent (an older deployment)", async () => {
        // `@dopl/client` normalizes a missing envelope key to `false`, so this is
        // belt and braces on the render: an absent notice is never a warning.
        const postChannelMessage = vitest_1.vi.fn(async () => ({
            id: "m1",
            seq: 12,
            kind: "message",
            authorUserId: "u-me",
            metadata: {},
        }));
        const client = stubClient({ postChannelMessage });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "hello");
        (0, vitest_1.expect)(res.content[0].text).not.toContain("THAT THREAD IS CLOSED");
    });
});
