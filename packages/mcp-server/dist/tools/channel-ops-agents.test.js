"use strict";
/**
 * THE AGENT ROW — `dopl_channel` agents / summon_agent / rename_agent /
 * set_agent_status / disengage_agent.
 *
 * Two things are pinned here, and the second is a security property:
 *
 *  1. WHAT EACH OP DOES. A handle resolves to a row of THIS channel (so
 *     `rename_agent` sends an agent ID even though the caller typed `@quartz`),
 *     and every refusal says what did NOT happen — an agent that reads "nothing
 *     changed" does not retry blind. The refusals are also not
 *     interchangeable: rename/park is OWNER-ONLY, disengage is
 *     OWNER-OR-ENGAGER, and borrowing one line for the other op talks a caller
 *     out of the one write they are entitled to make.
 *  2. NARRATION. An agent HANDLE is member-typed and an agent's OWNER NAME is
 *     `profiles.display_name`, which nothing in the product validates. Both
 *     land in lines this tool wrote, outside any untrusted-content framing, so
 *     both go through the neutralizer — and NO handle is ever rendered without
 *     its immutable id, because the handle is the owner's claim and the id is
 *     the server's record.
 *
 * THE OTHER HALF: `join_thread` / `leave_thread` are in
 * `channel-ops-participants.test.ts`, split out of here at the §2 500-line cap.
 * The seam is the row being written: everything below mutates the AGENT row
 * (`channel_agents`, via `createChannelAgent` / `updateChannelAgent`) under the
 * owner rule, while join/leave mutate the PARTICIPANT SET
 * (`channel_task_participants`, via `addThreadParticipant` /
 * `removeThreadParticipant`) under the thread-curation rule — a different
 * table, a different authority, and a 403 that means something else. The
 * harness both halves need is `agent-ops-fixtures.ts`.
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
const agent_ops_fixtures_1 = require("./agent-ops-fixtures");
(0, vitest_1.describe)('op="agents" — the room\'s roster', () => {
    (0, vitest_1.it)("names every agent by handle AND id, with status and owner", async () => {
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opAgents)((0, agent_ops_fixtures_1.stubClient)(), "general", "u-me"));
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
        const client = (0, agent_ops_fixtures_1.stubClient)({ listChannelAgents: vitest_1.vi.fn(async () => []) });
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opAgents)(client, "general", "u-me"));
        (0, vitest_1.expect)(text).toContain("No agents in **`General`** yet");
        (0, vitest_1.expect)(text).toContain('op="summon_agent"');
    });
    (0, vitest_1.it)("NEUTRALIZES a hostile owner display name (the roster's untrusted half)", async () => {
        const client = (0, agent_ops_fixtures_1.stubClient)({
            listChannelMembers: vitest_1.vi.fn(async () => [
                { userId: "u-bob", displayName: narration_fixtures_1.FORGERY, role: "member" },
            ]),
        });
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opAgents)(client, "general", "u-me"));
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
    });
    (0, vitest_1.it)("NEUTRALIZES a hostile handle — the column CHECK is not the render's excuse", async () => {
        // A handle cannot hold this today (`^[a-z][a-z0-9-]{1,30}$`). The renderer
        // is still what guarantees it: a charset rule is an INPUT fence on one
        // table, and deciding per site whether a value is "really" reachable is the
        // reasoning that left close_thread rendering a raw peer title.
        const client = (0, agent_ops_fixtures_1.stubClient)({
            listChannelAgents: vitest_1.vi.fn(async () => [{ ...agent_ops_fixtures_1.QUARTZ, name: narration_fixtures_1.FORGERY }]),
        });
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opAgents)(client, "general", "u-me"));
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        // The id is still there — a claim the reader can check.
        (0, vitest_1.expect)(text).toContain("`agent-1`");
    });
    (0, vitest_1.it)("frames the roster as DATA before rendering any of it", async () => {
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opAgents)((0, agent_ops_fixtures_1.stubClient)(), "general", "u-me"));
        const header = text.indexOf("SECURITY:");
        (0, vitest_1.expect)(header).toBeGreaterThan(-1);
        (0, vitest_1.expect)(header).toBeLessThan(text.indexOf("`quartz`"));
    });
});
(0, vitest_1.describe)('op="summon_agent"', () => {
    (0, vitest_1.it)("summons with no name (the pool path) and teaches addressing", async () => {
        const createChannelAgent = vitest_1.vi.fn(async () => agent_ops_fixtures_1.QUARTZ);
        const client = (0, agent_ops_fixtures_1.stubClient)({ createChannelAgent });
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opSummonAgent)(client, "general"));
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
        const client = (0, agent_ops_fixtures_1.stubClient)({
            createChannelAgent: vitest_1.vi.fn(async () => ({ ...agent_ops_fixtures_1.QUARTZ, name: narration_fixtures_1.FORGERY })),
        });
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opSummonAgent)(client, "general"));
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        (0, vitest_1.expect)(text).toContain("`agent-1`");
    });
    (0, vitest_1.it)("forwards an explicit name", async () => {
        const createChannelAgent = vitest_1.vi.fn(async () => agent_ops_fixtures_1.QUARTZ);
        const client = (0, agent_ops_fixtures_1.stubClient)({ createChannelAgent });
        await (0, channel_ops_agents_1.opSummonAgent)(client, "general", "quartz");
        (0, vitest_1.expect)(createChannelAgent.mock.calls[0]).toEqual(["chan-1", { name: "quartz" }]);
    });
    (0, vitest_1.it)("a taken handle says nothing was summoned and how to proceed", async () => {
        const client = (0, agent_ops_fixtures_1.stubClient)({
            createChannelAgent: vitest_1.vi.fn(async () => {
                throw (0, agent_ops_fixtures_1.apiError)(409);
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
        const updateChannelAgent = vitest_1.vi.fn(async () => ({ ...agent_ops_fixtures_1.QUARTZ, name: "beryl" }));
        const client = (0, agent_ops_fixtures_1.stubClient)({ updateChannelAgent });
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opRenameAgent)(client, "general", "@Quartz", "beryl"));
        (0, vitest_1.expect)(updateChannelAgent.mock.calls[0]).toEqual([
            "chan-1",
            "agent-1",
            { op: "rename", name: "beryl" },
        ]);
        (0, vitest_1.expect)(text).toContain("Renamed `quartz` (`agent-1`) to `beryl` (`agent-1`)");
        (0, vitest_1.expect)(text).toContain("the id is unchanged");
    });
    (0, vitest_1.it)("a 403 says the owner rule and that nothing changed", async () => {
        const client = (0, agent_ops_fixtures_1.stubClient)({
            updateChannelAgent: vitest_1.vi.fn(async () => {
                throw (0, agent_ops_fixtures_1.apiError)(403);
            }),
        });
        const res = await (0, channel_ops_agents_1.opRenameAgent)(client, "general", "onyx", "beryl");
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("belongs to the member who summoned it");
        (0, vitest_1.expect)(res.content[0].text).toContain("Nothing changed");
    });
    (0, vitest_1.it)("an unknown handle lists the agents the room DOES have", async () => {
        const res = await (0, channel_ops_agents_1.opSetAgentStatus)((0, agent_ops_fixtures_1.stubClient)(), "general", "topaz", "parked");
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("No agent `topaz` in this channel");
        (0, vitest_1.expect)(res.content[0].text).toContain("`quartz` (`agent-1`)");
    });
    (0, vitest_1.it)("dismissal says the row and attribution survive (it is not a delete)", async () => {
        const client = (0, agent_ops_fixtures_1.stubClient)({
            updateChannelAgent: vitest_1.vi.fn(async () => ({ ...agent_ops_fixtures_1.QUARTZ, status: "dismissed" })),
        });
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opSetAgentStatus)(client, "general", "quartz", "dismissed"));
        (0, vitest_1.expect)(text).toContain("to dismissed");
        (0, vitest_1.expect)(text).toContain("stays attributed to it");
    });
});
(0, vitest_1.describe)('op="disengage_agent" — ending an engagement', () => {
    (0, vitest_1.it)("resolves a HANDLE to the agent ID and sends the payload-free disengage op", async () => {
        const updateChannelAgent = vitest_1.vi.fn(async () => ({
            ...agent_ops_fixtures_1.QUARTZ,
            engagedAt: null,
            engagedBy: null,
        }));
        const client = (0, agent_ops_fixtures_1.stubClient)({ updateChannelAgent });
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opDisengageAgent)(client, "general", "@Quartz"));
        (0, vitest_1.expect)(updateChannelAgent.mock.calls[0]).toEqual([
            "chan-1",
            "agent-1",
            { op: "disengage" },
        ]);
        (0, vitest_1.expect)(text).toContain("Disengaged `quartz` (`agent-1`)");
        // The STATE it leaves behind, in the terms the law uses — an agent told only
        // "disengaged" does not know whether it may still answer anything.
        (0, vitest_1.expect)(text).toContain("IDLE again");
        (0, vitest_1.expect)(text).toContain('acts only on messages that ADDRESS it (to_agent="<handle>")');
    });
    (0, vitest_1.it)("says it is IDEMPOTENT, so a no-op read is not mistaken for evidence of an exchange", async () => {
        const client = (0, agent_ops_fixtures_1.stubClient)({
            updateChannelAgent: vitest_1.vi.fn(async () => ({ ...agent_ops_fixtures_1.QUARTZ, engagedAt: null, engagedBy: null })),
        });
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opDisengageAgent)(client, "general", "quartz"));
        (0, vitest_1.expect)(text).toContain("Idempotent");
    });
    (0, vitest_1.it)("never offers the caller a RE-ENGAGE — its own posts cannot cause one", async () => {
        // THE FALSE SENTENCE THIS REPLACES, and it was pinned HERE, by this suite:
        // "To pick the exchange back up, address it by handle again — that
        // re-engages it." `recordAgentEngagement`
        // (src/features/channels/server/service-writes-agents.ts) opens with
        // `if (ctx.source === "agent") return;` — engagement needs a HUMAN
        // CREDENTIAL, since `authorKind` is caller-assertable and `ctx.source` is
        // derived from the token — and every post made through this tool carries an
        // agent token. So the remedy the op handed its reader was an effect the
        // reader cannot produce: the tag would deliver, the agent would answer that
        // one message, and it would be idle again on the next turn with nothing
        // saying why. A test that pins a sentence is only as good as the sentence.
        const client = (0, agent_ops_fixtures_1.stubClient)({
            updateChannelAgent: vitest_1.vi.fn(async () => ({ ...agent_ops_fixtures_1.QUARTZ, engagedAt: null, engagedBy: null })),
        });
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opDisengageAgent)(client, "general", "quartz"));
        (0, vitest_1.expect)(text).not.toContain("re-engages it");
        (0, vitest_1.expect)(text).toContain("YOU CANNOT RE-ENGAGE IT");
        (0, vitest_1.expect)(text).toContain("engagement is stamped only for a HUMAN author");
        // …and it names the mechanism the reader CAN cause instead of leaving it
        // with a denial and no route: a thread's participant set is sustained
        // attention that never goes through engagement at all.
        (0, vitest_1.expect)(text).toContain('op="create_thread"');
        (0, vitest_1.expect)(text).toContain('participants=["agent:<its handle>"]');
    });
    (0, vitest_1.it)("a 403 states the OWNER-OR-ENGAGER rule, never the owner-only one", async () => {
        // THE REFUSAL THIS OP MAY NOT BORROW. `agentWriteError`'s line ("an agent
        // belongs to the member who summoned it, and only that member may rename or
        // park it") is true of rename/park and FALSE here: the server also allows
        // the human recorded in `engaged_by` (service-agents.ts#disengageAgent). An
        // engager told they must own the agent stops asking for the one agent write
        // they are entitled to make.
        const client = (0, agent_ops_fixtures_1.stubClient)({
            updateChannelAgent: vitest_1.vi.fn(async () => {
                throw (0, agent_ops_fixtures_1.apiError)(403, "CHANNEL_AGENT_FORBIDDEN");
            }),
        });
        const res = await (0, channel_ops_agents_1.opDisengageAgent)(client, "general", "onyx");
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = res.content[0].text;
        (0, vitest_1.expect)(text).toContain("SUMMONED it or by the human who ENGAGED it");
        (0, vitest_1.expect)(text).toContain("nothing changed");
        (0, vitest_1.expect)(text).not.toContain("only that member may rename or park it");
    });
    (0, vitest_1.it)("an unknown handle never reaches the route, and lists the room's agents", async () => {
        const updateChannelAgent = vitest_1.vi.fn();
        const res = await (0, channel_ops_agents_1.opDisengageAgent)((0, agent_ops_fixtures_1.stubClient)({ updateChannelAgent }), "general", "topaz");
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(res.content[0].text).toContain("No agent `topaz` in this channel");
        (0, vitest_1.expect)(updateChannelAgent).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("NEUTRALIZES the handle it renders — a disengage names a peer's agent", async () => {
        const forged = { ...agent_ops_fixtures_1.ONYX, name: narration_fixtures_1.FORGERY };
        const client = (0, agent_ops_fixtures_1.stubClient)({
            listChannelAgents: vitest_1.vi.fn(async () => [forged]),
            updateChannelAgent: vitest_1.vi.fn(async () => forged),
        });
        const text = await (0, agent_ops_fixtures_1.textOf)((0, channel_ops_agents_1.opDisengageAgent)(client, "general", "agent-2"));
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        (0, vitest_1.expect)(text).toContain("`agent-2`");
    });
});
