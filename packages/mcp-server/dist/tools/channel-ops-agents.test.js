"use strict";
/**
 * THE MULTIPLAYER OPS — `dopl_channel` agents / summon_agent / rename_agent /
 * set_agent_status / join_thread / leave_thread.
 *
 * Two things are pinned here, and the second is a security property:
 *
 *  1. WHAT EACH OP DOES. A handle resolves to a row of THIS channel (so
 *     `rename_agent` sends an agent ID even though the caller typed `@quartz`),
 *     a join sends the right `{kind, id}` pair, and every refusal says what did
 *     NOT happen — an agent that reads "nothing changed" does not retry blind.
 *  2. NARRATION. An agent HANDLE is member-typed and an agent's OWNER NAME is
 *     `profiles.display_name`, which nothing in the product validates. Both
 *     land in lines this tool wrote, outside any untrusted-content framing, so
 *     both go through the neutralizer — and NO handle is ever rendered without
 *     its immutable id, because the handle is the owner's claim and the id is
 *     the server's record.
 *
 * The forgery payload and its assertions are the SHARED ones
 * (`narration-fixtures.ts`) — a private copy is how an assertion drifts into
 * meaning something weaker. The @dopl/client is hand-stubbed; nothing
 * transports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const channel_ops_agents_1 = require("./channel-ops-agents");
const narration_fixtures_1 = require("./narration-fixtures");
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
const ONYX = { ...QUARTZ, id: "agent-2", ownerUserId: "u-bob", name: "onyx", status: "parked" };
const BOB = { userId: "u-bob", email: "bob@x.com", displayName: "Bob", status: "active" };
function stubClient(overrides = {}) {
    return {
        listChannels: vitest_1.vi.fn(async () => [CHANNEL]),
        listChannelMembers: vitest_1.vi.fn(async () => [
            { userId: "u-me", displayName: "Me", role: "owner" },
            { userId: "u-bob", displayName: "Bob", role: "member" },
        ]),
        listChannelAgents: vitest_1.vi.fn(async () => [QUARTZ, ONYX]),
        listWorkspaceMembers: vitest_1.vi.fn(async () => [BOB]),
        ...overrides,
    };
}
/** An HTTP-shaped rejection, duck-typed exactly like @dopl/client's errors. */
function apiError(status, code) {
    return Object.assign(new Error(`HTTP ${status}`), { status, code });
}
const textOf = async (res) => (await res).content.map((c) => c.text).join("\n");
(0, vitest_1.describe)('op="agents" — the room\'s roster', () => {
    (0, vitest_1.it)("names every agent by handle AND id, with status and owner", async () => {
        const text = await textOf((0, channel_ops_agents_1.opAgents)(stubClient(), "general", "u-me"));
        (0, vitest_1.expect)(text).toContain("2 agents");
        (0, vitest_1.expect)(text).toContain("`quartz` (`agent-1`)");
        (0, vitest_1.expect)(text).toContain("`onyx` (`agent-2`)");
        (0, vitest_1.expect)(text).toContain("· active ·");
        (0, vitest_1.expect)(text).toContain("· parked ·");
        // The caller's own agent is marked by whose it is, not by a bare uuid.
        (0, vitest_1.expect)(text).toContain("summoned by you");
        (0, vitest_1.expect)(text).toContain("`Bob` (`u-bob`)");
    });
    (0, vitest_1.it)("an empty roster points at summon_agent instead of rendering a heading", async () => {
        const client = stubClient({ listChannelAgents: vitest_1.vi.fn(async () => []) });
        const text = await textOf((0, channel_ops_agents_1.opAgents)(client, "general", "u-me"));
        (0, vitest_1.expect)(text).toContain("No agents in **`General`** yet");
        (0, vitest_1.expect)(text).toContain('op="summon_agent"');
    });
    (0, vitest_1.it)("NEUTRALIZES a hostile owner display name (the roster's untrusted half)", async () => {
        const client = stubClient({
            listChannelMembers: vitest_1.vi.fn(async () => [
                { userId: "u-bob", displayName: narration_fixtures_1.FORGERY, role: "member" },
            ]),
        });
        const text = await textOf((0, channel_ops_agents_1.opAgents)(client, "general", "u-me"));
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
    });
    (0, vitest_1.it)("NEUTRALIZES a hostile handle — the column CHECK is not the render's excuse", async () => {
        // A handle cannot hold this today (`^[a-z][a-z0-9-]{1,30}$`). The renderer
        // is still what guarantees it: a charset rule is an INPUT fence on one
        // table, and deciding per site whether a value is "really" reachable is the
        // reasoning that left close_thread rendering a raw peer title.
        const client = stubClient({
            listChannelAgents: vitest_1.vi.fn(async () => [{ ...QUARTZ, name: narration_fixtures_1.FORGERY }]),
        });
        const text = await textOf((0, channel_ops_agents_1.opAgents)(client, "general", "u-me"));
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        // The id is still there — a claim the reader can check.
        (0, vitest_1.expect)(text).toContain("`agent-1`");
    });
    (0, vitest_1.it)("frames the roster as DATA before rendering any of it", async () => {
        const text = await textOf((0, channel_ops_agents_1.opAgents)(stubClient(), "general", "u-me"));
        const header = text.indexOf("SECURITY:");
        (0, vitest_1.expect)(header).toBeGreaterThan(-1);
        (0, vitest_1.expect)(header).toBeLessThan(text.indexOf("`quartz`"));
    });
});
(0, vitest_1.describe)('op="summon_agent"', () => {
    (0, vitest_1.it)("summons with no name (the pool path) and teaches addressing", async () => {
        const createChannelAgent = vitest_1.vi.fn(async () => QUARTZ);
        const client = stubClient({ createChannelAgent });
        const text = await textOf((0, channel_ops_agents_1.opSummonAgent)(client, "general"));
        (0, vitest_1.expect)(createChannelAgent.mock.calls[0]).toEqual(["chan-1", {}]);
        (0, vitest_1.expect)(text).toContain("Summoned agent `quartz` (`agent-1`)");
        // The call example takes the server-issued ID, not the member-typed handle
        // (both work on `to_agent`). The handle is stated once, through
        // `agentLabel`, which is the only place it may be rendered at all.
        (0, vitest_1.expect)(text).toContain('to_agent="agent-1"');
        (0, vitest_1.expect)(text).toContain("as_agent");
        (0, vitest_1.expect)(text).toContain("REQUIRED for anything it writes to be attributed");
    });
    (0, vitest_1.it)("NEUTRALIZES the handle in the teaching line — no raw splice into a call example", async () => {
        // The old line built `to_agent="${agent.name}"` / `as_agent="${agent.name}"`
        // by interpolation, which is the one narration hole this file's own header
        // forbids: a handle is member-typed, and a charset CHECK on one column is
        // not the renderer's excuse (see channel-agent-refs.ts).
        const client = stubClient({
            createChannelAgent: vitest_1.vi.fn(async () => ({ ...QUARTZ, name: narration_fixtures_1.FORGERY })),
        });
        const text = await textOf((0, channel_ops_agents_1.opSummonAgent)(client, "general"));
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        (0, vitest_1.expect)(text).toContain("`agent-1`");
    });
    (0, vitest_1.it)("forwards an explicit name", async () => {
        const createChannelAgent = vitest_1.vi.fn(async () => QUARTZ);
        const client = stubClient({ createChannelAgent });
        await (0, channel_ops_agents_1.opSummonAgent)(client, "general", "quartz");
        (0, vitest_1.expect)(createChannelAgent.mock.calls[0]).toEqual(["chan-1", { name: "quartz" }]);
    });
    (0, vitest_1.it)("a taken handle says nothing was summoned and how to proceed", async () => {
        const client = stubClient({
            createChannelAgent: vitest_1.vi.fn(async () => {
                throw apiError(409);
            }),
        });
        const res = await (0, channel_ops_agents_1.opSummonAgent)(client, "general", "quartz");
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("Nothing was summoned");
        (0, vitest_1.expect)(res.content[0].text).toContain("`quartz`");
    });
});
(0, vitest_1.describe)('op="rename_agent" / op="set_agent_status" — owner-only writes', () => {
    (0, vitest_1.it)("resolves a HANDLE (even @-prefixed) and sends the agent ID", async () => {
        const updateChannelAgent = vitest_1.vi.fn(async () => ({ ...QUARTZ, name: "beryl" }));
        const client = stubClient({ updateChannelAgent });
        const text = await textOf((0, channel_ops_agents_1.opRenameAgent)(client, "general", "@Quartz", "beryl"));
        (0, vitest_1.expect)(updateChannelAgent.mock.calls[0]).toEqual([
            "chan-1",
            "agent-1",
            { op: "rename", name: "beryl" },
        ]);
        (0, vitest_1.expect)(text).toContain("Renamed `quartz` (`agent-1`) to `beryl` (`agent-1`)");
        (0, vitest_1.expect)(text).toContain("the id is unchanged");
    });
    (0, vitest_1.it)("a 403 says the owner rule and that nothing changed", async () => {
        const client = stubClient({
            updateChannelAgent: vitest_1.vi.fn(async () => {
                throw apiError(403);
            }),
        });
        const res = await (0, channel_ops_agents_1.opRenameAgent)(client, "general", "onyx", "beryl");
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("belongs to the member who summoned it");
        (0, vitest_1.expect)(res.content[0].text).toContain("Nothing changed");
    });
    (0, vitest_1.it)("an unknown handle lists the agents the room DOES have", async () => {
        const res = await (0, channel_ops_agents_1.opSetAgentStatus)(stubClient(), "general", "topaz", "parked");
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("No agent `topaz` in this channel");
        (0, vitest_1.expect)(res.content[0].text).toContain("`quartz` (`agent-1`)");
    });
    (0, vitest_1.it)("dismissal says the row and attribution survive (it is not a delete)", async () => {
        const client = stubClient({
            updateChannelAgent: vitest_1.vi.fn(async () => ({ ...QUARTZ, status: "dismissed" })),
        });
        const text = await textOf((0, channel_ops_agents_1.opSetAgentStatus)(client, "general", "quartz", "dismissed"));
        (0, vitest_1.expect)(text).toContain("to dismissed");
        (0, vitest_1.expect)(text).toContain("stays attributed to it");
    });
});
(0, vitest_1.describe)('op="join_thread" / op="leave_thread" — breakout-room membership', () => {
    (0, vitest_1.it)("an AGENT participant is sent as {kind:'agent', id}", async () => {
        const addThreadParticipant = vitest_1.vi.fn(async () => ({
            id: "p-1",
            threadId: "thread-1",
            kind: "agent",
            userId: null,
            agentId: "agent-1",
        }));
        const client = stubClient({ addThreadParticipant });
        const text = await textOf((0, channel_ops_agents_1.opJoinThread)(client, "general", "thread-1", { agent: "quartz" }));
        (0, vitest_1.expect)(addThreadParticipant.mock.calls[0]).toEqual([
            "chan-1",
            "thread-1",
            { kind: "agent", id: "agent-1" },
        ]);
        (0, vitest_1.expect)(text).toContain("Added `quartz` (`agent-1`) to thread `thread-1`");
        (0, vitest_1.expect)(text).toContain("BREAKOUT ROOM");
        // The law holds inside a breakout room too.
        (0, vitest_1.expect)(text).toContain("acts only when ADDRESSED");
    });
    (0, vitest_1.it)("a MEMBER participant is sent as {kind:'user', id} and is told NOBODY was notified", async () => {
        // B3. `joinThreadParticipant` (src/features/channels/server/
        // service-participants.ts) inserts ONE row: it posts no message, and
        // `channel_task_participants` is deliberately NOT in the realtime
        // publication, so nothing reaches the person on any surface. This line used
        // to say "Admitting a PERSON notifies them", under a test named "notifies,
        // never spawns" — a promise nothing in the product keeps.
        const addThreadParticipant = vitest_1.vi.fn(async () => ({
            id: "p-2",
            threadId: "thread-1",
            kind: "user",
            userId: "u-bob",
            agentId: null,
        }));
        const client = stubClient({ addThreadParticipant });
        const text = await textOf((0, channel_ops_agents_1.opJoinThread)(client, "general", "thread-1", { member: "bob@x.com" }));
        (0, vitest_1.expect)(addThreadParticipant.mock.calls[0]).toEqual([
            "chan-1",
            "thread-1",
            { kind: "user", id: "u-bob" },
        ]);
        (0, vitest_1.expect)(text).toContain("notifies NOBODY");
        (0, vitest_1.expect)(text).not.toContain("notifies them");
        // The true half survives, and the remedy is the one thing that DOES reach
        // a person: an addressed post in the thread.
        (0, vitest_1.expect)(text).toContain("never spawns their agent");
        (0, vitest_1.expect)(text).toContain('thread="thread-1"');
        (0, vitest_1.expect)(text).toContain('to="<them>"');
    });
    (0, vitest_1.it)("an AGENT participant is told it must claim itself with as_agent to post", async () => {
        // S1. `mayWriteThread` lets an agent participant write only when the call
        // supplied `authorAgentId`, i.e. `as_agent`. Admitting the agent is half
        // the job; the other half is a param nothing used to mention.
        const client = stubClient({
            addThreadParticipant: vitest_1.vi.fn(async () => ({
                id: "p-1",
                threadId: "thread-1",
                kind: "agent",
                userId: null,
                agentId: "agent-1",
            })),
        });
        const text = await textOf((0, channel_ops_agents_1.opJoinThread)(client, "general", "thread-1", { agent: "quartz" }));
        (0, vitest_1.expect)(text).toContain("as_agent");
        (0, vitest_1.expect)(text).toContain("the server checks the set against the agent a post CLAIMS");
    });
    (0, vitest_1.it)("a CURATION 403 does not tell the caller they left the channel", async () => {
        // The curation rule (service-participants.ts) refuses anyone who is not the
        // thread's creator, its target, or an existing user participant —
        // TaskForbiddenError → 403 TASK_FORBIDDEN. Mapping every 403 to "you are
        // not a member of that channel" turned an ordinary refusal into an alarming
        // false claim about the caller's own membership.
        const client = stubClient({
            addThreadParticipant: vitest_1.vi.fn(async () => {
                throw apiError(403, "TASK_FORBIDDEN");
            }),
        });
        const res = await (0, channel_ops_agents_1.opJoinThread)(client, "general", "thread-1", { agent: "quartz" });
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = res.content[0].text;
        (0, vitest_1.expect)(text).not.toContain("you are not a member");
        (0, vitest_1.expect)(text).toContain("curated by the member who OPENED that thread");
        (0, vitest_1.expect)(text).toContain("have NOT been removed");
        // And it must not send the caller off to manufacture a duplicate room.
        (0, vitest_1.expect)(text).not.toContain('op="create_thread"');
    });
    (0, vitest_1.it)("a CHANNEL 403 still says the caller is not a member", async () => {
        const client = stubClient({
            addThreadParticipant: vitest_1.vi.fn(async () => {
                throw apiError(403, "CHANNEL_FORBIDDEN");
            }),
        });
        const res = await (0, channel_ops_agents_1.opJoinThread)(client, "general", "thread-1", { agent: "quartz" });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("you are not a member of that channel");
    });
    (0, vitest_1.it)("an EJECT 403 on leave states the narrower rule, not a membership claim", async () => {
        const client = stubClient({
            removeThreadParticipant: vitest_1.vi.fn(async () => {
                throw apiError(403, "TASK_FORBIDDEN");
            }),
        });
        const res = await (0, channel_ops_agents_1.opLeaveThread)(client, "general", "thread-1", { agent: "onyx" });
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = res.content[0].text;
        (0, vitest_1.expect)(text).not.toContain("you are not a member");
        (0, vitest_1.expect)(text).toContain("ejecting anyone else is the call of the member who opened");
    });
    (0, vitest_1.it)("naming BOTH a member and an agent is refused, not silently preferred", async () => {
        const addThreadParticipant = vitest_1.vi.fn();
        const client = stubClient({ addThreadParticipant });
        const res = await (0, channel_ops_agents_1.opJoinThread)(client, "general", "thread-1", {
            member: "bob@x.com",
            agent: "quartz",
        });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(addThreadParticipant).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("naming NEITHER says which param to pass", async () => {
        const res = await (0, channel_ops_agents_1.opJoinThread)(stubClient(), "general", "thread-1", {});
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("`member`");
        (0, vitest_1.expect)(res.content[0].text).toContain("`agent`");
    });
    (0, vitest_1.it)("leave removes the identity and says the removal is idempotent", async () => {
        const removeThreadParticipant = vitest_1.vi.fn(async () => undefined);
        const client = stubClient({ removeThreadParticipant });
        const text = await textOf((0, channel_ops_agents_1.opLeaveThread)(client, "general", "thread-1", { agent: "onyx" }));
        (0, vitest_1.expect)(removeThreadParticipant.mock.calls[0]).toEqual([
            "chan-1",
            "thread-1",
            { kind: "agent", id: "agent-2" },
        ]);
        (0, vitest_1.expect)(text).toContain("idempotent");
    });
    (0, vitest_1.it)("a thread of another channel is a not-found, not a raw throw", async () => {
        const client = stubClient({
            addThreadParticipant: vitest_1.vi.fn(async () => {
                throw apiError(404);
            }),
        });
        const res = await (0, channel_ops_agents_1.opJoinThread)(client, "general", "thread-9", { agent: "quartz" });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("No thread `thread-9`");
    });
});
