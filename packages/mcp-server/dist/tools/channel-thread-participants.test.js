"use strict";
/**
 * THE THREAD PARTICIPANT SET — `op="create_thread"`'s `participants` seed, and
 * the set `op="get_thread"` renders back.
 *
 * What these pin, and why each one is worth a test:
 *
 *  - A SEED IS RESOLVED AGAINST THE ROSTER THE ROUTE CHECKS. `participants`
 *    arrives as `"agent:<handle>"` / `"user:<email>"` and must leave as
 *    `{kind, id}` refs resolved against the CHANNEL roster. Resolving against
 *    the WORKSPACE roster (as this used to) put a live, titled, empty,
 *    unanswerable thread in the channel and then reported "No thread was
 *    opened" — the B2 case.
 *  - A REFUSAL SAYS WHETHER A ROOM EXISTS. A pre-call refusal says nothing was
 *    created; a 400 that DOES get through may have left a thread behind, so it
 *    sends the caller to look rather than retry blind.
 *  - `as_agent` IS REFUSED HERE, not silently dropped. `TaskCreateSchema` has
 *    nowhere to put it, and an agent-attributed opening request classifies as
 *    `agent-escalation` on the receiving desktop — notify-only, spawning
 *    nothing, which is the one thing create_thread exists to do.
 *  - THE SET IS RENDERED BY BOTH NAMES — an agent by handle AND id, a person by
 *    member ref — an EMPTY set says pair-gated rather than saying nothing, and
 *    an unnameable agent still renders by id when the roster fetch fails.
 *
 * THE OTHER HALF: post-time addressing (`to_agent` / `as_agent` / `to_agents` /
 * `intent`) stays in `channel-agent-addressing.test.ts`, which this was split
 * out of at the §2 500-line cap — see that file's header for why the seam runs
 * here. Mutating a set AFTER the thread exists (`join_thread` / `leave_thread`)
 * is a third suite, `channel-ops-participants.test.ts`. The harness this shares
 * with the addressing half is `agent-addressing-fixtures.ts`.
 *
 * The @dopl/client is hand-stubbed; nothing transports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const channel_1 = require("./channel");
const channel_ops_threads_1 = require("./channel-ops-threads");
const channel_ops_read_1 = require("./channel-ops-read");
const agent_addressing_fixtures_1 = require("./agent-addressing-fixtures");
(0, vitest_1.describe)('op="create_thread" — participants (the breakout room)', () => {
    const created = {
        thread: { id: "thread-1", title: "Ship it", mode: "interactive" },
        openingSeq: 41,
    };
    (0, vitest_1.it)("resolves the prefix form into {kind, id} refs", async () => {
        const createChannelThread = vitest_1.vi.fn(async () => created);
        const client = (0, agent_addressing_fixtures_1.stubClient)({ createChannelThread });
        const res = await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Ship it", "please help", "bob@x.com", undefined, undefined, null, ["agent:@Quartz", "user:cara@x.com"]);
        const [, input] = createChannelThread.mock.calls[0];
        (0, vitest_1.expect)(input.participants).toEqual([
            { kind: "agent", id: "agent-1" },
            { kind: "user", id: "u-cara" },
        ]);
        const text = (0, agent_addressing_fixtures_1.textOf)(res);
        (0, vitest_1.expect)(text).toContain("BREAKOUT ROOM");
        (0, vitest_1.expect)(text).toContain("2 extra participants");
    });
    (0, vitest_1.it)("a prefixless entry is refused and NO thread is opened", async () => {
        const createChannelThread = vitest_1.vi.fn(async () => created);
        const client = (0, agent_addressing_fixtures_1.stubClient)({ createChannelThread });
        const res = await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Ship it", "please help", "bob@x.com", undefined, undefined, null, ["quartz"]);
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)((0, agent_addressing_fixtures_1.textOf)(res)).toContain('"agent:<handle or agent id>"');
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
        const client = (0, agent_addressing_fixtures_1.stubClient)({ createChannelThread });
        const res = await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Ship it", "please help", "bob@x.com", undefined, undefined, null, ["user:dale@x.com"]);
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(createChannelThread).not.toHaveBeenCalled();
        const text = (0, agent_addressing_fixtures_1.textOf)(res);
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
        const client = (0, agent_addressing_fixtures_1.stubClient)({
            createChannelThread: vitest_1.vi.fn(async () => {
                throw (0, agent_addressing_fixtures_1.apiError)(400, "CHANNEL_PARTICIPANT_NOT_MEMBER");
            }),
        });
        const res = await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Ship it", "please help", "bob@x.com", undefined, undefined, null, ["user:cara@x.com"]);
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = (0, agent_addressing_fixtures_1.textOf)(res);
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
        const client = (0, agent_addressing_fixtures_1.stubClient)({ createChannelThread });
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
        const client = (0, agent_addressing_fixtures_1.stubClient)({ createChannelThread });
        const res = await (0, channel_ops_threads_1.opCreateThread)(client, "general", "Ship it", "please help", "bob@x.com");
        const [, input] = createChannelThread.mock.calls[0];
        (0, vitest_1.expect)(input.participants).toBeUndefined();
        (0, vitest_1.expect)((0, agent_addressing_fixtures_1.textOf)(res)).not.toContain("BREAKOUT ROOM");
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
        const client = (0, agent_addressing_fixtures_1.stubClient)({
            getChannelThread: vitest_1.vi.fn(async () => ({
                ...THREAD,
                participants: [
                    { id: "p1", threadId: "thread-1", kind: "user", userId: "u-bob", agentId: null },
                    { id: "p2", threadId: "thread-1", kind: "agent", userId: null, agentId: "agent-1" },
                ],
            })),
        });
        const text = (0, agent_addressing_fixtures_1.textOf)(await (0, channel_ops_read_1.opGetThread)(client, "general", "thread-1", "u-me"));
        (0, vitest_1.expect)(text).toContain("participants (2)");
        (0, vitest_1.expect)(text).toContain("agent `quartz` (`agent-1`)");
        (0, vitest_1.expect)(text).toContain("`Bob` (`u-bob`)");
        (0, vitest_1.expect)(text).toContain("BREAKOUT ROOM");
    });
    (0, vitest_1.it)("an EMPTY set says the thread is pair-gated, rather than saying nothing", async () => {
        const client = (0, agent_addressing_fixtures_1.stubClient)({
            getChannelThread: vitest_1.vi.fn(async () => ({ ...THREAD, participants: [] })),
        });
        const text = (0, agent_addressing_fixtures_1.textOf)(await (0, channel_ops_read_1.opGetThread)(client, "general", "thread-1", "u-me"));
        (0, vitest_1.expect)(text).toContain("participants: none");
        (0, vitest_1.expect)(text).toContain("only the member who opened it");
    });
    (0, vitest_1.it)("an unnameable agent still renders by id (the roster fetch fails soft)", async () => {
        const client = (0, agent_addressing_fixtures_1.stubClient)({
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
        const text = (0, agent_addressing_fixtures_1.textOf)(await (0, channel_ops_read_1.opGetThread)(client, "general", "thread-1", "u-me"));
        (0, vitest_1.expect)(text).toContain("agent `agent-1`");
    });
});
