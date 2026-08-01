"use strict";
/**
 * AGENT ADDRESSING ON THE EXISTING OPS — `post`'s `to_agent` / `as_agent`,
 * `create_thread`'s `participants`, and the participant set `get_thread` now
 * renders.
 *
 * What these pin, and why each one is worth a test:
 *
 *  - A HANDLE IS RESOLVED TO AN ID before the call. An agent knows the name the
 *    room addresses it by, not a uuid; the route wants the uuid. If that
 *    resolution regresses, every agent-addressed post silently becomes an
 *    ordinary one.
 *  - AN ORDINARY POST PAYS NOTHING. No `to_agent`/`as_agent` means no roster
 *    round-trip at all — this is the hot write path.
 *  - AN AGENT IDENTITY IS NOT ASSUMABLE. The server refuses a foreign
 *    `as_agent` with a 403; the tool must say what was refused and that nothing
 *    was posted, or the caller re-sends the same forbidden claim.
 *  - AN AGENT ADDRESS IS AN ADDRESS. The server stamps the agent's OWNER as
 *    `to_user_id`, so a `to_agent` post wakes a machine and must NOT carry the
 *    "nothing put this in front of an agent" warning.
 *  - AND WHEN BOTH ADDRESSES ARE SET, the agent's owner wins — silently at the
 *    route, so the result has to say it.
 *
 * The @dopl/client is hand-stubbed; nothing transports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const channel_1 = require("./channel");
const channel_ops_write_1 = require("./channel-ops-write");
const channel_ops_threads_1 = require("./channel-ops-threads");
const channel_ops_read_1 = require("./channel-ops-read");
const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };
const QUARTZ = {
    id: "agent-1",
    channelId: "chan-1",
    workspaceId: "ws-1",
    ownerUserId: "u-me",
    name: "quartz",
    status: "active",
    createdAt: "2026-07-31T00:00:00Z",
    updatedAt: "2026-07-31T00:00:00Z",
};
/** Bob's agent — the one this caller may ADDRESS but may never speak AS. */
const ONYX = { ...QUARTZ, id: "agent-2", ownerUserId: "u-bob", name: "onyx" };
const BOB = { userId: "u-bob", email: "bob@x.com", displayName: "Bob", status: "active" };
const CARA = { userId: "u-cara", email: "cara@x.com", displayName: "Cara", status: "active" };
/** In the WORKSPACE, not in the channel — the B2 case, and the common one. */
const DALE = { userId: "u-dale", email: "dale@x.com", displayName: "Dale", status: "active" };
function stubClient(overrides = {}) {
    const postChannelMessage = vitest_1.vi.fn(async () => ({
        id: "m1",
        seq: 12,
        kind: "message",
        metadata: {},
        authorUserId: "u-me",
    }));
    return {
        listChannels: vitest_1.vi.fn(async () => [CHANNEL]),
        listChannelAgents: vitest_1.vi.fn(async () => [QUARTZ, ONYX]),
        // The CHANNEL roster — a strict subset of the workspace. Dale is only in
        // the workspace, which is exactly the shape B2 is about.
        listChannelMembers: vitest_1.vi.fn(async () => [
            { userId: "u-me", displayName: "Me", email: "me@x.com", role: "owner" },
            { userId: "u-bob", displayName: "Bob", email: "bob@x.com", role: "member" },
            { userId: "u-cara", displayName: "Cara", email: "cara@x.com", role: "member" },
        ]),
        listWorkspaceMembers: vitest_1.vi.fn(async () => [BOB, CARA, DALE]),
        listChannelThreads: vitest_1.vi.fn(async () => []),
        postChannelMessage,
        ...overrides,
    };
}
function apiError(status, code) {
    return Object.assign(new Error(`HTTP ${status}`), { status, code });
}
const textOf = (res) => res.content.map((c) => c.text).join("\n");
(0, vitest_1.describe)('op="post" — to_agent / as_agent', () => {
    (0, vitest_1.it)("resolves a handle to an AGENT ID and sends both fields", async () => {
        const client = stubClient();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "take this", {
            toAgent: "onyx",
            asAgent: "@Quartz",
        });
        const post = client.postChannelMessage;
        const [, input] = post.mock.calls[0];
        (0, vitest_1.expect)(input.toAgent).toBe("agent-2");
        (0, vitest_1.expect)(input.authorAgentId).toBe("agent-1");
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain("addressed to agent `onyx` (`agent-2`)");
        (0, vitest_1.expect)(text).toContain("as agent `quartz` (`agent-1`)");
    });
    (0, vitest_1.it)("hands the per-call agent to the footer (the LOCUS), and only then", async () => {
        const withAgent = await (0, channel_ops_write_1.opPost)(stubClient(), "general", "hi", {
            asAgent: "quartz",
        });
        (0, vitest_1.expect)(withAgent._callerAgent).toEqual({ id: "agent-1", name: "quartz" });
        const plain = await (0, channel_ops_write_1.opPost)(stubClient(), "general", "hi");
        (0, vitest_1.expect)(plain._callerAgent).toBeUndefined();
    });
    (0, vitest_1.it)("an ordinary post costs NO roster round-trip", async () => {
        const client = stubClient();
        await (0, channel_ops_write_1.opPost)(client, "general", "just chat");
        (0, vitest_1.expect)(client.listChannelAgents).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("an unknown handle is refused BEFORE the post, naming the room's agents", async () => {
        const client = stubClient();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "take this", { toAgent: "topaz" });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(textOf(res)).toContain("`quartz` (`agent-1`)");
        (0, vitest_1.expect)(client.postChannelMessage).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("a 403 on as_agent says the identity was refused and nothing was posted", async () => {
        const client = stubClient({
            postChannelMessage: vitest_1.vi.fn(async () => {
                throw apiError(403);
            }),
        });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "acting as Bob's agent", {
            asAgent: "onyx",
        });
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain("`onyx` (`agent-2`)");
        (0, vitest_1.expect)(text).toContain("only be spoken for by the member who summoned it");
        (0, vitest_1.expect)(text).toContain("Nothing was posted");
    });
    (0, vitest_1.it)("S1: a thread 403 with NO as_agent names the missing param, not a new thread", async () => {
        // `mayWriteThread` (service-writes-metadata.ts): once a thread has
        // participants, an AGENT participant may post only when the call supplied
        // `authorAgentId`. So the commonest 403 on a thread the caller legitimately
        // belongs to is a MISSING PARAM — and the old arm answered it with "that
        // thread belongs to two other members … open your own with
        // op=create_thread", which manufactures a duplicate room for the same work.
        const client = stubClient({
            postChannelMessage: vitest_1.vi.fn(async () => {
                throw apiError(403, "TASK_FORBIDDEN");
            }),
        });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "progress", { thread: "thread-1" });
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain('as_agent="<your handle>"');
        (0, vitest_1.expect)(text.indexOf("as_agent")).toBeLessThan(text.indexOf("join_thread"));
        (0, vitest_1.expect)(text).not.toContain('op="create_thread"');
        (0, vitest_1.expect)(text).toContain("nothing was posted");
    });
    (0, vitest_1.it)("S1: a thread 403 WITH as_agent is a set problem, not an ownership one", async () => {
        const client = stubClient({
            postChannelMessage: vitest_1.vi.fn(async () => {
                throw apiError(403, "TASK_FORBIDDEN");
            }),
        });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "progress", {
            thread: "thread-1",
            asAgent: "quartz",
        });
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = textOf(res);
        // NOT the agent-ownership refusal: the code says which 403 this is, and
        // `quartz` is the caller's own agent.
        (0, vitest_1.expect)(text).not.toContain("only be spoken for by the member who summoned it");
        (0, vitest_1.expect)(text).toContain('op="get_thread"');
        (0, vitest_1.expect)(text).not.toContain('op="create_thread"');
    });
    (0, vitest_1.it)("addressing an AGENT counts as addressed — no 'nobody was woken' warning", async () => {
        const res = await (0, channel_ops_write_1.opPost)(stubClient(), "general", "work please", {
            toAgent: "onyx",
        });
        (0, vitest_1.expect)(textOf(res)).not.toContain("NOT ADDRESSED");
    });
    (0, vitest_1.it)("`to` + `to_agent` that disagree: says the AGENT's owner is who it reached", async () => {
        const res = await (0, channel_ops_write_1.opPost)(stubClient(), "general", "work please", {
            to: "cara@x.com",
            toAgent: "onyx",
        });
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain("they name different people");
        (0, vitest_1.expect)(text).toContain("was not notified");
    });
    (0, vitest_1.it)("`to` + `to_agent` that AGREE says nothing extra", async () => {
        const res = await (0, channel_ops_write_1.opPost)(stubClient(), "general", "work please", {
            to: "bob@x.com",
            toAgent: "onyx",
        });
        (0, vitest_1.expect)(textOf(res)).not.toContain("they name different people");
    });
});
(0, vitest_1.describe)('op="post" — to_agents (the multi-address) and intent', () => {
    (0, vitest_1.it)("sends EVERY addressed agent as ids, in the caller's order, and names them all", async () => {
        // ORDER IS LOAD-BEARING: the server stamps the FIRST agent's owner as
        // `to_user_id` and mirrors the first id into the compat scalar
        // `metadata.to_agent_id` (service-writes-agents.ts). Sorting or set-ifying
        // here would silently re-point which machine the message is delivered to.
        const client = stubClient();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "work together on X", {
            toAgents: ["@Onyx", "quartz"],
        });
        const post = client.postChannelMessage;
        const [, input] = post.mock.calls[0];
        (0, vitest_1.expect)(input.toAgents).toEqual(["agent-2", "agent-1"]);
        // The compat scalar still names the head, so nothing about the single-agent
        // wire had to change for the multi case to exist.
        (0, vitest_1.expect)(input.toAgent).toBe("agent-2");
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain("addressed to 2 agents `onyx` (`agent-2`), `quartz` (`agent-1`)");
    });
    (0, vitest_1.it)("a ONE-agent to_agents sends the same request a to_agent always did", async () => {
        // No `toAgents` on the wire at all for a single address: the server treats
        // `toAgent` as a one-element list, so a one-agent post keeps the exact shape
        // it has had, and the result line keeps saying "agent", not "1 agents".
        const client = stubClient();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "take this", { toAgents: ["onyx"] });
        const post = client.postChannelMessage;
        const [, input] = post.mock.calls[0];
        (0, vitest_1.expect)(input.toAgent).toBe("agent-2");
        (0, vitest_1.expect)(input.toAgents).toBeUndefined();
        (0, vitest_1.expect)(textOf(res)).toContain("addressed to agent `onyx` (`agent-2`)");
    });
    (0, vitest_1.it)("merges `to_agent` with `to_agents` and collapses a duplicate to ONE address", async () => {
        const client = stubClient();
        await (0, channel_ops_write_1.opPost)(client, "general", "both of you", {
            toAgent: "quartz",
            toAgents: ["agent-1", "onyx"],
        });
        const post = client.postChannelMessage;
        const [, input] = post.mock.calls[0];
        // `quartz` and `agent-1` are the same row — one address, not two — and the
        // dedupe is by RESOLVED ID, so a handle and an id collapse.
        (0, vitest_1.expect)(input.toAgents).toEqual(["agent-1", "agent-2"]);
    });
    (0, vitest_1.it)("ALL OR NOTHING: one unknown ref refuses the whole post before it is sent", async () => {
        // A partial address is the worse failure by far: the caller believes N
        // machines are working and fewer are, and nothing in the result says which.
        const client = stubClient();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "both of you", {
            toAgents: ["onyx", "topaz"],
        });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(textOf(res)).toContain("No agent `topaz` in this channel");
        (0, vitest_1.expect)(client.postChannelMessage).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("a multi-address tells the sender to expect ONE thread, with the derived key", async () => {
        const res = await (0, channel_ops_write_1.opPost)(stubClient(), "general", "work together", {
            toAgents: ["onyx", "quartz"],
        });
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain("ADDRESSED 2 AGENTS");
        (0, vitest_1.expect)(text).toContain("reached on ITS OWN owner's machine, separately");
        (0, vitest_1.expect)(text).toContain('client_msg_id="thread-open-chan-1-12"');
        (0, vitest_1.expect)(text).toContain("expect ONE thread back, not 2");
    });
    (0, vitest_1.it)("carries `intent` through to the client, and stamps nothing when it is absent", async () => {
        const client = stubClient();
        await (0, channel_ops_write_1.opPost)(client, "general", "sounds good", { intent: "chat" });
        await (0, channel_ops_write_1.opPost)(client, "general", "please do X", {});
        const post = client.postChannelMessage;
        (0, vitest_1.expect)(post.mock.calls[0][1].intent).toBe("chat");
        // ABSENT, not "request": an omitted intent stamps no metadata key at all
        // server-side, so an existing caller's wire is unchanged.
        (0, vitest_1.expect)(post.mock.calls[1][1].intent).toBeUndefined();
    });
    (0, vitest_1.it)("a CHAT post is not told to re-post with `to` — it is unaddressed on purpose", async () => {
        // `unaddressedPostNote`'s remedy is "re-post it with to=<one member>", which
        // is exactly what an intent="chat" caller decided against. Rendering it here
        // would talk every deliberate chat message into becoming a request.
        const res = await (0, channel_ops_write_1.opPost)(stubClient(), "general", "morning all", {
            intent: "chat",
        });
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain("CHAT — you posted this as `intent`=\"chat\"");
        (0, vitest_1.expect)(text).toContain("NOT a delivery failure to repair");
        (0, vitest_1.expect)(text).not.toContain("NOT ADDRESSED —");
    });
    (0, vitest_1.it)("CHAT plus an address is refused BEFORE anything is sent", async () => {
        for (const addressed of [
            { to: "bob@x.com" },
            { toAgent: "onyx" },
            { toAgents: ["onyx"] },
        ]) {
            const client = stubClient();
            const res = await (0, channel_ops_write_1.opPost)(client, "general", "hi", {
                intent: "chat",
                ...addressed,
            });
            (0, vitest_1.expect)(res.isError).toBe(true);
            (0, vitest_1.expect)(textOf(res)).toContain("cannot be addressed — nothing was sent");
            (0, vitest_1.expect)(client.postChannelMessage).not.toHaveBeenCalled();
            // Not even a roster read: a contradictory post has nothing to resolve.
            (0, vitest_1.expect)(client.listChannelAgents).not.toHaveBeenCalled();
        }
    });
    (0, vitest_1.it)("the route's CHANNEL_CHAT_ADDRESSED 400 answers with the RULE, not with 'unrecognized'", async () => {
        // Unreachable while the local guard holds — classified anyway, because
        // "unreachable" is the assumption the status-only branch this replaced was
        // built on. Reaching it means the tool and the route disagree, and the
        // caller still needs the rule rather than an opaque 400.
        const client = stubClient({
            postChannelMessage: vitest_1.vi.fn(async () => {
                throw apiError(400, "CHANNEL_CHAT_ADDRESSED");
            }),
        });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "hi", {});
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(textOf(res)).toContain('A message with `intent`="chat" cannot be addressed');
    });
});
(0, vitest_1.describe)('op="create_thread" — participants (the breakout room)', () => {
    const created = {
        thread: { id: "thread-1", title: "Ship it", mode: "interactive" },
        openingSeq: 41,
    };
    (0, vitest_1.it)("resolves the prefix form into {kind, id} refs", async () => {
        const createChannelThread = vitest_1.vi.fn(async () => created);
        const client = stubClient({ createChannelThread });
        const res = await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Ship it", "please help", "bob@x.com", undefined, undefined, null, ["agent:@Quartz", "user:cara@x.com"]);
        const [, input] = createChannelThread.mock.calls[0];
        (0, vitest_1.expect)(input.participants).toEqual([
            { kind: "agent", id: "agent-1" },
            { kind: "user", id: "u-cara" },
        ]);
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain("BREAKOUT ROOM");
        (0, vitest_1.expect)(text).toContain("2 extra participants");
    });
    (0, vitest_1.it)("a prefixless entry is refused and NO thread is opened", async () => {
        const createChannelThread = vitest_1.vi.fn(async () => created);
        const client = stubClient({ createChannelThread });
        const res = await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Ship it", "please help", "bob@x.com", undefined, undefined, null, ["quartz"]);
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(textOf(res)).toContain('"agent:<handle or agent id>"');
        (0, vitest_1.expect)(createChannelThread).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("B2: a WORKSPACE member who is not in the CHANNEL is refused BEFORE the call", async () => {
        // `createTask` inserts the thread row, THEN seeds participants, THEN posts
        // the opening message. `seedThreadParticipants` → `assertIdentityBelongs`
        // 400s `CHANNEL_PARTICIPANT_NOT_MEMBER` for a workspace-only colleague, so
        // resolving the seed against the WORKSPACE roster (as this used to) put a
        // live, titled, empty, unanswerable thread in the channel and then reported
        // "No thread was opened". The roster this resolves against is now the one
        // the route checks, so the call never happens.
        const createChannelThread = vitest_1.vi.fn(async () => created);
        const client = stubClient({ createChannelThread });
        const res = await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Ship it", "please help", "bob@x.com", undefined, undefined, null, ["user:dale@x.com"]);
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(createChannelThread).not.toHaveBeenCalled();
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain("No member `dale@x.com` in this channel");
        (0, vitest_1.expect)(text).toContain('op="members"');
        (0, vitest_1.expect)(text).toContain('op="invite"');
        (0, vitest_1.expect)(text).toContain("Nothing was created");
    });
    (0, vitest_1.it)("B2: a participant 400 that DOES get through never claims no thread was opened", async () => {
        // The residue case — a membership that changed between the resolve and the
        // call. The thread may exist with no request in it, so the arm has to send
        // the caller to look instead of retrying blind (a retry with the same
        // client_msg_id returns the stored thread and re-seeds nothing).
        const client = stubClient({
            createChannelThread: vitest_1.vi.fn(async () => {
                throw apiError(400, "CHANNEL_PARTICIPANT_NOT_MEMBER");
            }),
        });
        const res = await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Ship it", "please help", "bob@x.com", undefined, undefined, null, ["user:cara@x.com"]);
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = textOf(res);
        (0, vitest_1.expect)(text).not.toContain("No thread was opened");
        (0, vitest_1.expect)(text).toContain("A THREAD MAY HAVE BEEN OPENED ANYWAY");
        (0, vitest_1.expect)(text).toContain('op="list_threads"');
        (0, vitest_1.expect)(text).toContain("does NOT re-seed the participant set");
    });
    (0, vitest_1.it)("S2: `as_agent` on create_thread is REFUSED, not silently dropped", async () => {
        // `TaskCreateSchema` has no `authorAgentId`, so the registrar had nowhere
        // to route this and dropped it — the opening request went out as the bare
        // human's and nothing said so. It is refused rather than wired through
        // because an agent-attributed message addressed to a person classifies as
        // `agent-escalation` on the receiving desktop: notify-only, spawning
        // nothing, which is the one thing create_thread exists to do.
        const createChannelThread = vitest_1.vi.fn(async () => created);
        const client = stubClient({ createChannelThread });
        let handler = null;
        const capture = ((_n, _d, _s, h) => {
            handler = h;
        });
        (0, channel_1.registerChannelTool)(capture, client);
        (0, vitest_1.expect)(handler).not.toBeNull();
        const res = await handler({
            op: "create_thread",
            channel: "general",
            title: "Ship it",
            body: "please help",
            to: "bob@x.com",
            as_agent: "quartz",
        });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(createChannelThread).not.toHaveBeenCalled();
        const text = res.content.map((c) => c.text).join("\n");
        (0, vitest_1.expect)(text).toContain("create_thread does not take `as_agent`");
        (0, vitest_1.expect)(text).toContain("nothing was created");
        (0, vitest_1.expect)(text).toContain('as_agent="<your handle>"');
    });
    (0, vitest_1.it)("no participants → the field is omitted and the thread stays pair-gated", async () => {
        const createChannelThread = vitest_1.vi.fn(async () => created);
        const client = stubClient({ createChannelThread });
        const res = await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Ship it", "please help", "bob@x.com");
        const [, input] = createChannelThread.mock.calls[0];
        (0, vitest_1.expect)(input.participants).toBeUndefined();
        (0, vitest_1.expect)(textOf(res)).not.toContain("BREAKOUT ROOM");
    });
});
(0, vitest_1.describe)('op="get_thread" — the participant set', () => {
    const THREAD = {
        id: "thread-1",
        channelId: "chan-1",
        workspaceId: "ws-1",
        title: "Ship it",
        status: "open",
        outcome: null,
        mode: "interactive",
        createdBy: "u-me",
        targetUserId: "u-bob",
        createdAt: "2026-07-28T00:00:00Z",
        updatedAt: "2026-07-28T00:00:00Z",
        closedAt: null,
        outcomeSummary: null,
    };
    (0, vitest_1.it)("names each participant — an agent by handle AND id, a person by member ref", async () => {
        const client = stubClient({
            getChannelThread: vitest_1.vi.fn(async () => ({
                ...THREAD,
                participants: [
                    { id: "p1", threadId: "thread-1", kind: "user", userId: "u-bob", agentId: null },
                    { id: "p2", threadId: "thread-1", kind: "agent", userId: null, agentId: "agent-1" },
                ],
            })),
        });
        const text = textOf(await (0, channel_ops_read_1.opGetThread)(client, "general", "thread-1", "u-me"));
        (0, vitest_1.expect)(text).toContain("participants (2)");
        (0, vitest_1.expect)(text).toContain("agent `quartz` (`agent-1`)");
        (0, vitest_1.expect)(text).toContain("`Bob` (`u-bob`)");
        (0, vitest_1.expect)(text).toContain("BREAKOUT ROOM");
    });
    (0, vitest_1.it)("an EMPTY set says the thread is pair-gated, rather than saying nothing", async () => {
        const client = stubClient({
            getChannelThread: vitest_1.vi.fn(async () => ({ ...THREAD, participants: [] })),
        });
        const text = textOf(await (0, channel_ops_read_1.opGetThread)(client, "general", "thread-1", "u-me"));
        (0, vitest_1.expect)(text).toContain("participants: none");
        (0, vitest_1.expect)(text).toContain("only the member who opened it");
    });
    (0, vitest_1.it)("an unnameable agent still renders by id (the roster fetch fails soft)", async () => {
        const client = stubClient({
            listChannelAgents: vitest_1.vi.fn(async () => {
                throw new Error("roster down");
            }),
            getChannelThread: vitest_1.vi.fn(async () => ({
                ...THREAD,
                participants: [
                    { id: "p2", threadId: "thread-1", kind: "agent", userId: null, agentId: "agent-1" },
                ],
            })),
        });
        const text = textOf(await (0, channel_ops_read_1.opGetThread)(client, "general", "thread-1", "u-me"));
        (0, vitest_1.expect)(text).toContain("agent `agent-1`");
    });
});
