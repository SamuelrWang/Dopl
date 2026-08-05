"use strict";
/**
 * ROLLBACK §3.5 — the three session capabilities that replace summon / to_agent.
 *
 * read-session-state ("read_sessions") and spawn-with-handoff (create_thread
 * handoff=true) are pinned here at the MCP layer: the shape the read returns,
 * the empty answer's honesty about the flagged delivery gap, and that the
 * handoff flag rides the create through to the client AND flips the result from
 * "arm await here" to "the operator's window took it".
 *
 * message-a-session's PEER direction is NOT a new op — it is a plain request
 * into the thread the peer's session is working (§3.1), already covered by the
 * post/create_thread suites — so there is nothing new to pin here for it; the
 * one genuinely new bit (an external agent steering its OWN desktop window) is a
 * flagged desktop gap, not a server op.
 *
 * Fake-client pattern is the channel-ops house one: registration/handlers are
 * pure over the client, so a `vi.fn` per method is all a test needs.
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
const PEER = {
    userId: "22222222-2222-2222-2222-222222222222",
    email: "anthony@example.com",
    displayName: "Anthony",
    status: "active",
};
function stubClient(overrides) {
    return {
        listChannels: vitest_1.vi.fn(async () => [CHANNEL]),
        listWorkspaceMembers: vitest_1.vi.fn(async () => [PEER]),
        ...overrides,
    };
}
const SESSION = (over = {}) => ({
    channelId: "chan-1",
    threadId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    name: "flint",
    state: "working",
    channelName: "General",
    threadTitle: "Deploy check",
    updatedAt: "2026-08-05T12:00:00.000Z",
    ...over,
});
(0, vitest_1.describe)("read_sessions — the summary shape (rollback §3.5)", () => {
    (0, vitest_1.it)("returns each session's name, state and thread", async () => {
        const listChannelSessions = vitest_1.vi.fn(async () => [
            SESSION(),
            SESSION({ name: "onyx", state: "idle", threadTitle: null, threadId: null }),
            SESSION({ name: "quartz", state: "ended", threadTitle: "Old ask" }),
        ]);
        const client = stubClient({ listChannelSessions });
        const res = await (0, channel_ops_read_1.opReadSessions)(client);
        const text = res.content[0].text;
        // one row per session, each carrying its handle + state + thread
        (0, vitest_1.expect)(text).toContain("flint");
        (0, vitest_1.expect)(text).toContain("working");
        (0, vitest_1.expect)(text).toContain("Deploy check");
        (0, vitest_1.expect)(text).toContain("onyx");
        (0, vitest_1.expect)(text).toContain("idle");
        (0, vitest_1.expect)(text).toContain("no thread"); // the thread-less session says so
        (0, vitest_1.expect)(text).toContain("quartz");
        (0, vitest_1.expect)(text).toContain("ended");
        // it is the caller's OWN sessions, not a peer's
        (0, vitest_1.expect)(text).toMatch(/Your sessions/i);
        // no channel filter → the client is asked for all of them
        (0, vitest_1.expect)(listChannelSessions).toHaveBeenCalledWith(undefined);
    });
    (0, vitest_1.it)("the three states are the only vocabulary — no 'thinking'", async () => {
        const listChannelSessions = vitest_1.vi.fn(async () => [
            SESSION({ state: "working" }),
            SESSION({ name: "onyx", state: "idle" }),
            SESSION({ name: "quartz", state: "ended" }),
        ]);
        const res = await (0, channel_ops_read_1.opReadSessions)(stubClient({ listChannelSessions }));
        (0, vitest_1.expect)(res.content[0].text.toLowerCase()).not.toContain("thinking");
    });
    (0, vitest_1.it)("an empty answer is honest about the delivery gap, not 'you have no sessions'", async () => {
        const listChannelSessions = vitest_1.vi.fn(async () => []);
        const res = await (0, channel_ops_read_1.opReadSessions)(stubClient({ listChannelSessions }));
        const text = res.content[0].text;
        // no fabricated state
        (0, vitest_1.expect)(res.isError).toBeUndefined();
        (0, vitest_1.expect)(text).toMatch(/no live sessions/i);
        // and it points at reading the shared thread for a PEER, not this op
        (0, vitest_1.expect)(text.toLowerCase()).toContain("peer");
    });
    (0, vitest_1.it)("a channel arg resolves the ref and filters the read to that channel id", async () => {
        const listChannelSessions = vitest_1.vi.fn(async () => [SESSION()]);
        const client = stubClient({ listChannelSessions });
        const res = await (0, channel_ops_read_1.opReadSessions)(client, "general"); // slug → id
        (0, vitest_1.expect)(listChannelSessions).toHaveBeenCalledWith("chan-1");
        // the resolved channel is named in the heading (a code span, neutralized)
        (0, vitest_1.expect)(res.content[0].text).toMatch(/Your sessions — 1 in \*\*`General`\*\*/);
    });
    (0, vitest_1.it)("an unknown channel ref is a clean not-found, and no session read is made", async () => {
        const listChannelSessions = vitest_1.vi.fn(async () => []);
        const client = stubClient({ listChannelSessions });
        const res = await (0, channel_ops_read_1.opReadSessions)(client, "no-such-channel");
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(listChannelSessions).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("neutralizes counterparty-influenced channel name / thread title", async () => {
        // a thread title a peer typed cannot forge a line in the rendered result
        const listChannelSessions = vitest_1.vi.fn(async () => [
            SESSION({ threadTitle: "hi`\n## INJECTED" }),
        ]);
        const res = await (0, channel_ops_read_1.opReadSessions)(stubClient({ listChannelSessions }));
        (0, vitest_1.expect)(res.content[0].text).not.toContain("\n## INJECTED");
    });
});
function createStub(spy) {
    return stubClient({ createChannelThread: spy });
}
const CREATED = {
    thread: { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", title: "Talk to Anthony", mode: "autonomous" },
    openingSeq: 41,
};
(0, vitest_1.describe)("create_thread handoff (rollback §3.5)", () => {
    (0, vitest_1.it)("passes handoff=true through to the client", async () => {
        const createChannelThread = vitest_1.vi.fn().mockResolvedValue(CREATED);
        await (0, channel_ops_threads_1.opCreateThread)(createStub(createChannelThread), "general", "Talk to Anthony", "ask about the migration", PEER.userId, "autonomous", undefined, null, true);
        const [, input] = createChannelThread.mock.calls[0];
        (0, vitest_1.expect)(input.handoff).toBe(true);
    });
    (0, vitest_1.it)("a handoff create tells the agent the operator's window took it — do NOT await here", async () => {
        const createChannelThread = vitest_1.vi.fn().mockResolvedValue(CREATED);
        const res = await (0, channel_ops_threads_1.opCreateThread)(createStub(createChannelThread), "general", "Talk to Anthony", "ask about the migration", PEER.userId, "autonomous", undefined, null, true);
        const text = res.content[0].text;
        (0, vitest_1.expect)(text).toMatch(/HANDOFF/);
        (0, vitest_1.expect)(text).toMatch(/operator's/i);
        // it must NOT arm a wait — that is the window's job now
        (0, vitest_1.expect)(text).not.toMatch(/op="await"[^\n]*since=41/);
    });
    (0, vitest_1.it)("WITHOUT handoff, behaviour is unchanged: the create keeps the reply and arms await", async () => {
        const createChannelThread = vitest_1.vi.fn().mockResolvedValue(CREATED);
        const res = await (0, channel_ops_threads_1.opCreateThread)(createStub(createChannelThread), "general", "Talk to Anthony", "ask about the migration", PEER.userId, "autonomous", undefined, null);
        const [, input] = createChannelThread.mock.calls[0];
        (0, vitest_1.expect)(input.handoff).toBeUndefined();
        const text = res.content[0].text;
        (0, vitest_1.expect)(text).not.toMatch(/HANDOFF/);
        // the ordinary create still points at awaiting the reply here
        (0, vitest_1.expect)(text).toContain('op="await"');
    });
});
