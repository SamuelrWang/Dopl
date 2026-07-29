"use strict";
/**
 * Focused unit tests for the v1.7 dopl_channel op deltas:
 *   - opPost folds `task` into metadata.taskId (explicit param wins);
 *   - opCloseTask forwards `summary` and surfaces it in the confirmation;
 *   - the read render labels an agent author "agent for <name>" (never a bare
 *     name), so a counterparty is not mistaken for its own operator.
 *
 * The @dopl/client is a hand-stubbed object (only the methods each op touches),
 * cast to DoplClient — registration/transport never run here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const channel_ops_write_1 = require("./channel-ops-write");
const channel_ops_read_1 = require("./channel-ops-read");
const CHANNEL = {
    id: "chan-1",
    slug: "general",
    name: "General",
    visibility: "private",
};
/** A client whose listChannels resolves the one test channel, plus overrides. */
function stubClient(overrides) {
    return {
        listChannels: vitest_1.vi.fn(async () => [CHANNEL]),
        ...overrides,
    };
}
(0, vitest_1.describe)("opPost — task threading (Feature 2a)", () => {
    (0, vitest_1.it)("folds `task` into metadata.taskId", async () => {
        const postChannelMessage = vitest_1.vi.fn();
        postChannelMessage.mockResolvedValue({ id: "m1", seq: 5, kind: "task_progress" });
        const client = stubClient({ postChannelMessage });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "did the thing", {
            task: "task-uuid",
            kind: "task_progress",
        });
        (0, vitest_1.expect)(res.isError).toBeFalsy();
        const [channelId, input] = postChannelMessage.mock.calls[0];
        (0, vitest_1.expect)(channelId).toBe("chan-1");
        (0, vitest_1.expect)(input.metadata).toEqual({ taskId: "task-uuid" });
    });
    (0, vitest_1.it)("merges `task` over caller metadata (explicit param wins)", async () => {
        const postChannelMessage = vitest_1.vi.fn();
        postChannelMessage.mockResolvedValue({ id: "m1", seq: 6, kind: "message" });
        const client = stubClient({ postChannelMessage });
        await (0, channel_ops_write_1.opPost)(client, "general", "reply", {
            task: "task-uuid",
            metadata: { taskId: "spoofed", keep: 1 },
        });
        const [, input] = postChannelMessage.mock.calls[0];
        (0, vitest_1.expect)(input.metadata).toEqual({ taskId: "task-uuid", keep: 1 });
    });
    (0, vitest_1.it)("leaves metadata untouched when no `task` is passed", async () => {
        const postChannelMessage = vitest_1.vi.fn();
        postChannelMessage.mockResolvedValue({ id: "m1", seq: 7, kind: "message" });
        const client = stubClient({ postChannelMessage });
        await (0, channel_ops_write_1.opPost)(client, "general", "chat", { metadata: { foo: "bar" } });
        const [, input] = postChannelMessage.mock.calls[0];
        (0, vitest_1.expect)(input.metadata).toEqual({ foo: "bar" });
    });
});
(0, vitest_1.describe)("opCloseTask — summary (Feature 3c)", () => {
    (0, vitest_1.it)("forwards `summary` to the client and surfaces it in the confirmation", async () => {
        const closeChannelTask = vitest_1.vi.fn();
        closeChannelTask.mockResolvedValue({ title: "Ship it", outcome: "completed" });
        const client = stubClient({ closeChannelTask });
        const res = await (0, channel_ops_write_1.opCloseTask)(client, "general", "task-uuid", "completed", "Shipped v2 to prod");
        const [channelId, taskId, input] = closeChannelTask.mock.calls[0];
        (0, vitest_1.expect)(channelId).toBe("chan-1");
        (0, vitest_1.expect)(taskId).toBe("task-uuid");
        (0, vitest_1.expect)(input).toEqual({ outcome: "completed", summary: "Shipped v2 to prod" });
        (0, vitest_1.expect)(res.content[0].text).toContain("Shipped v2 to prod");
    });
    (0, vitest_1.it)("omits the summary note when none is given", async () => {
        const closeChannelTask = vitest_1.vi.fn();
        closeChannelTask.mockResolvedValue({ title: "Ship it", outcome: "failed" });
        const client = stubClient({ closeChannelTask });
        const res = await (0, channel_ops_write_1.opCloseTask)(client, "general", "task-uuid", "failed");
        const [, , input] = closeChannelTask.mock.calls[0];
        (0, vitest_1.expect)(input).toEqual({ outcome: "failed", summary: undefined });
        (0, vitest_1.expect)(res.content[0].text).toBe("Closed task **Ship it** in **General** as failed.");
    });
});
(0, vitest_1.describe)("opPost — bad task mapping (Gap 4)", () => {
    (0, vitest_1.it)("maps a 400 on an unresolvable `task` (no `to`) to a clear message", async () => {
        const postChannelMessage = vitest_1.vi.fn(async () => {
            throw { status: 400 };
        });
        const client = stubClient({ postChannelMessage });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "progress", {
            task: "not-in-this-channel",
            kind: "task_progress",
        });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("not in this channel");
        (0, vitest_1.expect)(res.content[0].text).toContain("post without `task`");
    });
    (0, vitest_1.it)("still maps a 400 addressee error when `to` is set", async () => {
        // `to` resolves to a member, then the route rejects them as a non-member.
        const client = stubClient({
            listWorkspaceMembers: vitest_1.vi.fn(async () => [
                { userId: "u-p", email: "p@x.com", displayName: "Pat", status: "active" },
            ]),
            postChannelMessage: vitest_1.vi.fn(async () => {
                throw { status: 400 };
            }),
        });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "hi", { to: "p@x.com" });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("aren't a member");
    });
});
(0, vitest_1.describe)("opListTasks / opGetTask — task reads (Gap 1)", () => {
    const TASK = {
        id: "task-1",
        channelId: "chan-1",
        workspaceId: "ws-1",
        title: "Ship it",
        status: "open",
        outcome: null,
        mode: "interactive",
        createdBy: "u-a",
        targetUserId: "u-b",
        createdAt: "2026-07-28T00:00:00Z",
        updatedAt: "2026-07-28T00:00:00Z",
        closedAt: null,
        outcomeSummary: null,
    };
    (0, vitest_1.it)("renders a task list readably", async () => {
        const client = stubClient({
            listChannelTasks: vitest_1.vi.fn(async () => [
                TASK,
                { ...TASK, id: "task-2", title: "Done one", status: "closed", outcome: "completed", outcomeSummary: "shipped" },
            ]),
        });
        const res = await (0, channel_ops_read_1.opListTasks)(client, "general");
        const text = res.content[0].text;
        (0, vitest_1.expect)(res.isError).toBeFalsy();
        (0, vitest_1.expect)(text).toContain("2 tasks");
        (0, vitest_1.expect)(text).toContain("Ship it");
        (0, vitest_1.expect)(text).toContain("`task-1`");
        (0, vitest_1.expect)(text).toContain("shipped");
        (0, vitest_1.expect)(text).toContain('op="get_task"');
    });
    (0, vitest_1.it)("get_task renders one task's detail", async () => {
        const client = stubClient({
            getChannelTask: vitest_1.vi.fn(async () => ({ ...TASK, outcomeSummary: "all good" })),
        });
        const res = await (0, channel_ops_read_1.opGetTask)(client, "general", "task-1");
        const text = res.content[0].text;
        (0, vitest_1.expect)(res.isError).toBeFalsy();
        (0, vitest_1.expect)(text).toContain("Ship it");
        (0, vitest_1.expect)(text).toContain("all good");
        (0, vitest_1.expect)(text).toContain("`u-b`");
    });
    (0, vitest_1.it)("get_task maps a 404 (task not in channel) to a task-oriented not-found", async () => {
        const client = stubClient({
            getChannelTask: vitest_1.vi.fn(async () => {
                throw { status: 404 };
            }),
        });
        const res = await (0, channel_ops_read_1.opGetTask)(client, "general", "ghost");
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("No task `ghost`");
        (0, vitest_1.expect)(res.content[0].text).toContain('op="list_tasks"');
    });
});
(0, vitest_1.describe)("read render — counterparty identity (Feature 1b)", () => {
    function msg(overrides) {
        return {
            id: "m",
            seq: 1,
            channelId: "chan-1",
            authorUserId: "u-1",
            authorKind: "user",
            kind: "message",
            body: "hi",
            metadata: {},
            clientMsgId: null,
            createdAt: "2026-07-28T00:00:00Z",
            authorName: null,
            ...overrides,
        };
    }
    (0, vitest_1.it)("labels agents 'agent for <name>' and users by bare name", async () => {
        const client = stubClient({
            readChannelMessages: vitest_1.vi.fn(async () => [
                msg({ seq: 1, authorKind: "agent", authorUserId: "u-alice", authorName: "Alice" }),
                msg({ seq: 2, authorKind: "user", authorUserId: "u-bob", authorName: "Bob" }),
                msg({ seq: 3, authorKind: "agent", authorUserId: "u-x", authorName: null }),
                msg({ seq: 4, authorKind: "system", authorUserId: null, kind: "system", authorName: null }),
            ]),
        });
        const text = (await (0, channel_ops_read_1.opRead)(client, "general")).content[0].text;
        (0, vitest_1.expect)(text).toContain("agent for Alice");
        (0, vitest_1.expect)(text).toContain("Bob");
        (0, vitest_1.expect)(text).not.toContain("agent for Bob");
        // No authorName → fall back to the id, still marked as an agent.
        (0, vitest_1.expect)(text).toContain("agent for `u-x`");
        (0, vitest_1.expect)(text).toContain("system");
    });
});
