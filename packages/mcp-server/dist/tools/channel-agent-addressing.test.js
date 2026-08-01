"use strict";
/**
 * AGENT ADDRESSING ON `op="post"` — `to_agent` / `as_agent`, the `to_agents`
 * multi-address, and `intent`.
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
 * THE OTHER HALF: the thread PARTICIPANT SET — `create_thread`'s `participants`
 * seed and the set `get_thread` renders — is `channel-thread-participants.test.ts`,
 * split out of here at the §2 500-line cap along the line the ops already draw.
 * Addressing decides who ONE MESSAGE reaches and is resolved per post; a
 * participant set decides who may write in a ROOM at all and is seeded once,
 * server-side, against a different roster. Neither half's refusals are reachable
 * from the other's code path. The harness both need is
 * `agent-addressing-fixtures.ts` — shared, because the channel-vs-workspace
 * roster asymmetry it encodes is the subject of one half's tests.
 *
 * The @dopl/client is hand-stubbed; nothing transports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const channel_ops_write_1 = require("./channel-ops-write");
const agent_addressing_fixtures_1 = require("./agent-addressing-fixtures");
(0, vitest_1.describe)('op="post" — to_agent / as_agent', () => {
    (0, vitest_1.it)("resolves a handle to an AGENT ID and sends both fields", async () => {
        const client = (0, agent_addressing_fixtures_1.stubClient)();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "take this", {
            toAgent: "onyx",
            asAgent: "@Quartz",
        });
        const post = client.postChannelMessage;
        const [, input] = post.mock.calls[0];
        (0, vitest_1.expect)(input.toAgent).toBe("agent-2");
        (0, vitest_1.expect)(input.authorAgentId).toBe("agent-1");
        const text = (0, agent_addressing_fixtures_1.textOf)(res);
        (0, vitest_1.expect)(text).toContain("addressed to agent `onyx` (`agent-2`)");
        (0, vitest_1.expect)(text).toContain("as agent `quartz` (`agent-1`)");
    });
    (0, vitest_1.it)("hands the per-call agent to the footer (the LOCUS), and only then", async () => {
        const withAgent = await (0, channel_ops_write_1.opPost)((0, agent_addressing_fixtures_1.stubClient)(), "general", "hi", {
            asAgent: "quartz",
        });
        (0, vitest_1.expect)(withAgent._callerAgent).toEqual({ id: "agent-1", name: "quartz" });
        const plain = await (0, channel_ops_write_1.opPost)((0, agent_addressing_fixtures_1.stubClient)(), "general", "hi");
        (0, vitest_1.expect)(plain._callerAgent).toBeUndefined();
    });
    (0, vitest_1.it)("an ordinary post costs NO roster round-trip", async () => {
        const client = (0, agent_addressing_fixtures_1.stubClient)();
        await (0, channel_ops_write_1.opPost)(client, "general", "just chat");
        (0, vitest_1.expect)(client.listChannelAgents).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("an unknown handle is refused BEFORE the post, naming the room's agents", async () => {
        const client = (0, agent_addressing_fixtures_1.stubClient)();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "take this", { toAgent: "topaz" });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)((0, agent_addressing_fixtures_1.textOf)(res)).toContain("`quartz` (`agent-1`)");
        (0, vitest_1.expect)(client.postChannelMessage).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("a 403 on as_agent says the identity was refused and nothing was posted", async () => {
        const client = (0, agent_addressing_fixtures_1.stubClient)({
            postChannelMessage: vitest_1.vi.fn(async () => {
                throw (0, agent_addressing_fixtures_1.apiError)(403);
            }),
        });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "acting as Bob's agent", {
            asAgent: "onyx",
        });
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = (0, agent_addressing_fixtures_1.textOf)(res);
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
        const client = (0, agent_addressing_fixtures_1.stubClient)({
            postChannelMessage: vitest_1.vi.fn(async () => {
                throw (0, agent_addressing_fixtures_1.apiError)(403, "TASK_FORBIDDEN");
            }),
        });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "progress", { thread: "thread-1" });
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = (0, agent_addressing_fixtures_1.textOf)(res);
        (0, vitest_1.expect)(text).toContain('as_agent="<your handle>"');
        (0, vitest_1.expect)(text.indexOf("as_agent")).toBeLessThan(text.indexOf("join_thread"));
        (0, vitest_1.expect)(text).not.toContain('op="create_thread"');
        (0, vitest_1.expect)(text).toContain("nothing was posted");
    });
    (0, vitest_1.it)("S1: a thread 403 WITH as_agent is a set problem, not an ownership one", async () => {
        const client = (0, agent_addressing_fixtures_1.stubClient)({
            postChannelMessage: vitest_1.vi.fn(async () => {
                throw (0, agent_addressing_fixtures_1.apiError)(403, "TASK_FORBIDDEN");
            }),
        });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "progress", {
            thread: "thread-1",
            asAgent: "quartz",
        });
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = (0, agent_addressing_fixtures_1.textOf)(res);
        // NOT the agent-ownership refusal: the code says which 403 this is, and
        // `quartz` is the caller's own agent.
        (0, vitest_1.expect)(text).not.toContain("only be spoken for by the member who summoned it");
        (0, vitest_1.expect)(text).toContain('op="get_thread"');
        (0, vitest_1.expect)(text).not.toContain('op="create_thread"');
    });
    (0, vitest_1.it)("addressing an AGENT counts as addressed — no 'nobody was woken' warning", async () => {
        const res = await (0, channel_ops_write_1.opPost)((0, agent_addressing_fixtures_1.stubClient)(), "general", "work please", {
            toAgent: "onyx",
        });
        (0, vitest_1.expect)((0, agent_addressing_fixtures_1.textOf)(res)).not.toContain("NOT ADDRESSED");
    });
    (0, vitest_1.it)("`to` + `to_agent` that disagree: says the AGENT's owner is who it reached", async () => {
        const res = await (0, channel_ops_write_1.opPost)((0, agent_addressing_fixtures_1.stubClient)(), "general", "work please", {
            to: "cara@x.com",
            toAgent: "onyx",
        });
        const text = (0, agent_addressing_fixtures_1.textOf)(res);
        (0, vitest_1.expect)(text).toContain("they name different people");
        (0, vitest_1.expect)(text).toContain("was not notified");
    });
    (0, vitest_1.it)("`to` + `to_agent` that AGREE says nothing extra", async () => {
        const res = await (0, channel_ops_write_1.opPost)((0, agent_addressing_fixtures_1.stubClient)(), "general", "work please", {
            to: "bob@x.com",
            toAgent: "onyx",
        });
        (0, vitest_1.expect)((0, agent_addressing_fixtures_1.textOf)(res)).not.toContain("they name different people");
    });
});
(0, vitest_1.describe)('op="post" — to_agents (the multi-address) and intent', () => {
    (0, vitest_1.it)("sends EVERY addressed agent as ids, in the caller's order, and names them all", async () => {
        // ORDER IS LOAD-BEARING: the server stamps the FIRST agent's owner as
        // `to_user_id` and mirrors the first id into the compat scalar
        // `metadata.to_agent_id` (service-writes-agents.ts). Sorting or set-ifying
        // here would silently re-point which machine the message is delivered to.
        const client = (0, agent_addressing_fixtures_1.stubClient)();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "work together on X", {
            toAgents: ["@Onyx", "quartz"],
        });
        const post = client.postChannelMessage;
        const [, input] = post.mock.calls[0];
        (0, vitest_1.expect)(input.toAgents).toEqual(["agent-2", "agent-1"]);
        // The compat scalar still names the head, so nothing about the single-agent
        // wire had to change for the multi case to exist.
        (0, vitest_1.expect)(input.toAgent).toBe("agent-2");
        const text = (0, agent_addressing_fixtures_1.textOf)(res);
        (0, vitest_1.expect)(text).toContain("addressed to 2 agents `onyx` (`agent-2`), `quartz` (`agent-1`)");
    });
    (0, vitest_1.it)("a ONE-agent to_agents sends the same request a to_agent always did", async () => {
        // No `toAgents` on the wire at all for a single address: the server treats
        // `toAgent` as a one-element list, so a one-agent post keeps the exact shape
        // it has had, and the result line keeps saying "agent", not "1 agents".
        const client = (0, agent_addressing_fixtures_1.stubClient)();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "take this", { toAgents: ["onyx"] });
        const post = client.postChannelMessage;
        const [, input] = post.mock.calls[0];
        (0, vitest_1.expect)(input.toAgent).toBe("agent-2");
        (0, vitest_1.expect)(input.toAgents).toBeUndefined();
        (0, vitest_1.expect)((0, agent_addressing_fixtures_1.textOf)(res)).toContain("addressed to agent `onyx` (`agent-2`)");
    });
    (0, vitest_1.it)("merges `to_agent` with `to_agents` and collapses a duplicate to ONE address", async () => {
        const client = (0, agent_addressing_fixtures_1.stubClient)();
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
        const client = (0, agent_addressing_fixtures_1.stubClient)();
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "both of you", {
            toAgents: ["onyx", "topaz"],
        });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)((0, agent_addressing_fixtures_1.textOf)(res)).toContain("No agent `topaz` in this channel");
        (0, vitest_1.expect)(client.postChannelMessage).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("a multi-address tells the sender to expect ONE thread, with the derived key", async () => {
        const res = await (0, channel_ops_write_1.opPost)((0, agent_addressing_fixtures_1.stubClient)(), "general", "work together", {
            toAgents: ["onyx", "quartz"],
        });
        const text = (0, agent_addressing_fixtures_1.textOf)(res);
        (0, vitest_1.expect)(text).toContain("ADDRESSED 2 AGENTS");
        (0, vitest_1.expect)(text).toContain("reached on ITS OWN owner's machine, separately");
        (0, vitest_1.expect)(text).toContain('client_msg_id="thread-open-chan-1-12"');
        (0, vitest_1.expect)(text).toContain("expect ONE thread back, not 2");
    });
    (0, vitest_1.it)("carries `intent` through to the client, and stamps nothing when it is absent", async () => {
        const client = (0, agent_addressing_fixtures_1.stubClient)();
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
        const res = await (0, channel_ops_write_1.opPost)((0, agent_addressing_fixtures_1.stubClient)(), "general", "morning all", {
            intent: "chat",
        });
        const text = (0, agent_addressing_fixtures_1.textOf)(res);
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
            const client = (0, agent_addressing_fixtures_1.stubClient)();
            const res = await (0, channel_ops_write_1.opPost)(client, "general", "hi", {
                intent: "chat",
                ...addressed,
            });
            (0, vitest_1.expect)(res.isError).toBe(true);
            (0, vitest_1.expect)((0, agent_addressing_fixtures_1.textOf)(res)).toContain("cannot be addressed — nothing was sent");
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
        const client = (0, agent_addressing_fixtures_1.stubClient)({
            postChannelMessage: vitest_1.vi.fn(async () => {
                throw (0, agent_addressing_fixtures_1.apiError)(400, "CHANNEL_CHAT_ADDRESSED");
            }),
        });
        const res = await (0, channel_ops_write_1.opPost)(client, "general", "hi", {});
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)((0, agent_addressing_fixtures_1.textOf)(res)).toContain('A message with `intent`="chat" cannot be addressed');
    });
});
