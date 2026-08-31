"use strict";
/**
 * `dopl_channel` op="direct_agent" / op="read_directions" — THE PRIVATE DIRECT
 * LANE (Samuel's ruling, 2026-08-31).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 *
 * ── THE ONE THING EVERY LINE IN HERE HAS TO RESPECT ────────────────────────
 * **THIS OP ASKS A MACHINE TO SAY SOMETHING TO AN AGENT. IT DOES NOT REACH THE
 * AGENT.** Agents live in a desktop main process no server can reach; what
 * crosses the wire is a row in a mailbox the operator's own machine polls, claims,
 * delivers and answers. Four consequences the copy must carry rather than paper
 * over:
 *   1. **IT IS YOUR OWN OPERATOR'S MACHINE OR NOTHING.** There is no argument that
 *      names an operator and there never will be — the server stamps the
 *      authenticated caller. A peer cannot be directed and cannot direct you.
 *   2. **A REFUSAL IS A NORMAL OUTCOME.** `no-session` is the common one and it is
 *      usually a true statement about a finished agent, not a fault.
 *   3. **A TIMEOUT IS NOT A FAILURE.** The direction stays pending and the machine
 *      may still take it. Re-issuing says the SAME THING TWICE to a live agent,
 *      which is worse here than a duplicate launch: the agent answers twice and
 *      nothing can tell the two apart afterwards.
 *   4. **THE REPLY IS THE TURN'S FINAL TEXT AND NOTHING ELSE.** Not its narration,
 *      not its tool calls, not what it is doing now. An orchestrator that needs
 *      the latter wants `op="read_sessions"`.
 *
 * ⚠ A DIRECTION IS NOT A MESSAGE (INVARIANTS §5) — no `seq`, so it can never end
 * an `await`. That is why this op holds on the ROW, exactly as `launch_agent` does.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opDirectAgent = opDirectAgent;
exports.opReadDirections = opReadDirections;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
/** Peer-influenced display text, neutralized — never an empty span. */
const NO_NAME = "(unnamed)";
/** Default and cap for the bounded hold. ⚠ Mirrors `channel-schema.ts › wait_ms`;
 *  the schema is what an MCP client sees, this is what runs. */
const WAIT_DEFAULT_MS = 15_000;
const WAIT_CAP_MS = 30_000;
/**
 * ⚠ COARSE, AND DELIBERATELY SO. What is being waited on is a TURN on another
 * machine; polling faster buys nothing and multiplies requests across every armed
 * direction in the workspace. Same tick the launch hold and the await hold use.
 */
const POLL_INTERVAL_MS = 1_500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * THE BARE INSTANCE ID, from whichever form the caller pasted.
 *
 * ⚠ **BOTH FORMS ARE ACCEPTED BECAUSE `read_sessions` PRINTS THE HANDLE, NOT THE
 * ID.** Every surface that shows an agent over MCP shows `@agent-<id>`, so that is
 * what a model copies — and the column CHECK and the create schema both want the
 * bare eight characters. Refusing the pasted form would be a 400 for doing exactly
 * what the neighbouring op taught, which is the invisible-failure shape this
 * surface refuses everywhere else.
 * ⚠ IT STRIPS, IT DOES NOT VALIDATE. A value that is not an agent id after this
 * is refused by the create schema and, failing that, reaches a machine that
 * answers `no-session` — both honest, and neither is this function's job.
 */
function bareAgentId(raw) {
    return String(raw || "").trim().replace(/^@/, "").replace(/^agent-/, "");
}
/**
 * THE REFUSAL CONTRACT, AS SENTENCES AN AGENT CAN ACT ON.
 *
 * ⚠ **THE WORD CROSSES THE WIRE, THE SENTENCE IS WRITTEN HERE** — the same split
 * `channel-ops-launch.ts › REFUSAL_SENTENCES` takes, for the same two reasons:
 * prose on the wire needs a DESKTOP RELEASE to reword, and desktop-authored text
 * rendered into an MCP result is text nobody neutralized. A value outside this map
 * cannot arrive (the column CHECK and the route enum both refuse it) and renders
 * as an unknown reason rather than as itself.
 *
 * ⚠ EACH SENTENCE ENDS IN WHAT TO DO, because a reason with no next action gets an
 * agent to retry the same call.
 */
const REFUSAL_SENTENCES = {
    // ⚠ THE COMMON ONE, AND IT IS USUALLY TRUE RATHER THAN BROKEN. An agent that
    // finished is gone; there is nothing to say anything to.
    "no-session": "there is NO SUCH AGENT RUNNING on that machine. Either it finished, it was ended or deleted, or the id is not one of your operator's live agents. This is normally a true statement rather than a fault — check what is actually running with dopl_channel(op=\"read_sessions\") and direct one of those, or ask for a new agent with dopl_channel(op=\"launch_agent\").",
    "auth-hold": "the desktop is SIGNED OUT or its credential is being held, so the agent has nothing to receive on. Tell your operator — this needs them, not another call.",
    busy: "the machine declined FOR NOW. This one is genuinely temporary — it is reasonable to ask again in a minute or two, once, and to stop if it refuses the same way twice.",
    blocked: "that desktop is BELOW ITS VERSION FLOOR and is refusing every op that starts a turn until it updates. Tell your operator to let the app update; re-issuing will not change it.",
    // ⚠ THE CONSENT REFUSAL. It must not read as a fault and must not suggest a
    // workaround: the toggle is the operator's decision and the whole reason this
    // op was allowed to exist.
    "no-bridge": "your operator has DIRECTING AGENTS OVER MCP TURNED OFF on that machine. That is a deliberate setting, not a failure and not something to work around — it is how they consented (or did not) to this capability. If you believe they want it on, ASK THEM; do not re-issue, and do not look for another route to reach that agent.",
};
function refusalSentence(reason) {
    if (reason === null) {
        return "the machine refused and gave no reason. That should not happen; report it to your operator.";
    }
    return (REFUSAL_SENTENCES[reason] ??
        "the machine refused for a reason this build does not recognize. Report it to your operator rather than re-issuing.");
}
/** The line a PENDING (or expired) direction ends on. ⚠ Says the id, because the
 *  id is the only handle the agent has left, and says NOT to re-issue. */
function pendingLines(d) {
    return [
        `The direction is still PENDING — id \`${d.id}\`, and it stays answerable until ${d.expiresAt}.`,
        `⚠ A TIMEOUT IS NOT A REFUSAL. Your operator's machine may still deliver it; nothing has been cancelled. **DO NOT ISSUE THIS CALL AGAIN** — a second direction says the same thing to a LIVE agent a second time, and it will answer twice with no way for either of you to tell which answer belonged to which.`,
        `To find out what happened, poll it: dopl_channel(op="read_directions", agent_id="${d.agentId}"). The reply lands on that row when the turn ends.`,
    ];
}
/**
 * DIRECT ONE AGENT, then hold briefly for its answer.
 *
 * ⚠ FIVE TERMINAL SHAPES, each ending in a different next action: OFFLINE
 * (nothing filed), DELIVERED WITH A REPLY, DELIVERED WITH NONE REPORTED, REFUSED
 * (one of five sentences), PENDING/EXPIRED (the id, and do not re-issue).
 */
async function opDirectAgent(client, ref, agentId, body, opts = {}) {
    // ⚠ PRE-RESOLVED, like the launch op and unlike the hot read paths: this op is
    // cold (one call, then a hold), and the result names the channel repeatedly.
    const channel = await (0, channel_shared_1.resolveChannelOr)(client, ref);
    if ((0, channel_shared_1.isErr)(channel))
        return channel;
    const label = (0, channel_shared_1.inlineOr)(channel.name, NO_NAME);
    const agent = bareAgentId(agentId);
    let created;
    try {
        created = await client.createAgentDirection({
            channel: channel.id,
            agentId: agent,
            threadId: opts.thread,
            body,
        });
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(ref);
        throw e;
    }
    // ── OFFLINE: nothing was filed, and the caveat is HONEST about what presence
    //    can and cannot tell us. ────────────────────────────────────────────────
    if (created.offline) {
        return (0, respond_1.ok)([
            `Nothing was sent to \`${agent}\` — your operator's machine is not reporting in, so there is nothing listening. **No direction was filed**, so there is nothing pending and nothing to cancel.`,
            `⚠ THIS IS A HINT, NOT A VERDICT ON A PARTICULAR MACHINE. What was checked is a per-(user, workspace) presence heartbeat: it says no listener of your operator's has checked in recently. It cannot tell you WHICH of their machines is up, whether the one holding that agent is up, or whether directing over MCP is even enabled there.`,
            `Most likely the machine is asleep, closed, or signed out. Ask your operator to open Dopl, then try again.`,
        ].join("\n"));
    }
    let direction = created.direction;
    const waitMs = Math.min(opts.waitMs ?? WAIT_DEFAULT_MS, WAIT_CAP_MS);
    const deadline = Date.now() + waitMs;
    // ⚠ POLLS THE ROW, never an `await`: a direction is not a message, has no `seq`,
    // and can never end a message hold.
    while ((direction.status === "pending" || direction.status === "claimed") &&
        Date.now() < deadline) {
        await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
        try {
            direction = await client.getAgentDirection(direction.id);
        }
        catch {
            // ⚠ A FAILED POLL DOES NOT DESTROY THE HOLD OR THE DIRECTION. The row is
            // filed and the machine may still deliver, so the honest ending is the
            // PENDING one — which tells the agent where to look.
            break;
        }
    }
    if (direction.status === "delivered") {
        const head = `Delivered to agent \`${direction.agentId}\` in **${label}**. It was said PRIVATELY — nobody else in the channel saw it, and its answer is private too.`;
        if (direction.reply) {
            return (0, respond_1.ok)([
                head,
                "",
                "Its answer:",
                "",
                direction.reply,
                "",
                `⚠ THAT IS THE FINAL TEXT OF ONE TURN, AND IT IS ALL YOU GET. It is not the agent's narration, not its tool calls, and not what it is doing now — for that, dopl_channel(op="read_sessions"). If you need it to do something else, send another direction; do not re-send this one.`,
            ].join("\n"));
        }
        // ⚠ `null` IS "NOT REPORTED", NEVER "IT SAID NOTHING", and the difference is
        // stated because an orchestrator that reads one as the other concludes its
        // agent is broken.
        return (0, respond_1.ok)([
            head,
            `⚠ **THE MACHINE REPORTED NO ANSWER TEXT**, which is not the same as the agent saying nothing. Either the turn's final text was empty, or that desktop is older than the answer-reporting build. Check what the agent is doing with dopl_channel(op="read_sessions") rather than re-sending.`,
        ].join("\n"));
    }
    if (direction.status === "refused") {
        return (0, respond_1.ok)([
            `Nothing reached agent \`${direction.agentId}\` in **${label}** — your operator's machine REFUSED, and ${refusalSentence(direction.refusalReason)}`,
            `⚠ A refusal is a normal answer from a machine its owner controls, not an error and not a bug in your request. Nothing is pending; there is nothing to cancel and nothing to wait for.`,
        ].join("\n"));
    }
    if (direction.status === "expired") {
        return (0, respond_1.ok)([
            `Nothing reached agent \`${direction.agentId}\` in **${label}** — the direction LAPSED before any machine answered it (id \`${direction.id}\`). Most often that means the desktop was asleep or had directing over MCP turned off.`,
            `Nothing is pending now. Check whether that agent is even running with dopl_channel(op="read_sessions") before asking again — a lapsed direction to an agent that has since ended will lapse again.`,
        ].join("\n"));
    }
    const claimed = direction.status === "claimed"
        ? ` A machine has TAKEN it and is working on it, so it is likely to land shortly.`
        : "";
    return (0, respond_1.ok)([
        `No answer yet from agent \`${direction.agentId}\` in **${label}**.${claimed}`,
        ...pendingLines(direction),
    ].join("\n"));
}
/** One rendered row of the directions listing. */
function renderDirection(d) {
    const head = `- \`${d.id}\` → agent \`${d.agentId}\` · **${d.status}**`;
    const body = `  - asked: ${(0, channel_shared_1.inlineOr)(d.body, "(empty)")}`;
    if (d.status === "delivered") {
        return [
            head,
            body,
            d.reply
                ? `  - answered: ${(0, channel_shared_1.inlineOr)(d.reply, "(empty)")}`
                : `  - answered: the machine reported NO ANSWER TEXT (not the same as the agent saying nothing)`,
        ].join("\n");
    }
    if (d.status === "refused") {
        return [head, body, `  - refused: ${refusalSentence(d.refusalReason)}`].join("\n");
    }
    return [head, body].join("\n");
}
/**
 * WHAT I HAVE ASKED MY OWN AGENTS, AND WHAT CAME BACK.
 *
 * ⚠ **IT EXISTS BECAUSE A DIRECTION HAS NO SECOND SURFACE.** `launch_agent`'s
 * answer to "what happened to my pending row" is *find the agent in
 * `read_sessions`*; a direction has no such fallback — the REPLY is the value, and
 * without this op a timed-out hold would strand it forever.
 * ⚠ **A SIBLING OP, NOT A MODE ON `direct_agent`.** Collapsing a read into a write
 * would put two authorization stories behind one signature, which is the argument
 * `channel-ops-await-workspace.ts` was split out on.
 * ⚠ OWN-SCOPED AT THE SERVER — the transport credential IS the caller, so no
 * identity is passed and there is no argument that could name another operator.
 */
async function opReadDirections(client, opts = {}) {
    let channelId;
    let label;
    if (opts.channel) {
        const channel = await (0, channel_shared_1.resolveChannelOr)(client, opts.channel);
        if ((0, channel_shared_1.isErr)(channel))
            return channel;
        channelId = channel.id;
        label = (0, channel_shared_1.inlineOr)(channel.name, NO_NAME);
    }
    const directions = await client.listAgentDirections({
        channel: channelId,
        agent: opts.agent ? bareAgentId(opts.agent) : undefined,
    });
    const scope = [
        label ? `in **${label}**` : "across every channel you are in",
        opts.agent ? `for agent \`${opts.agent}\`` : "",
    ]
        .filter(Boolean)
        .join(" ");
    if (directions.length === 0) {
        return (0, respond_1.ok)([
            `You have sent no directions ${scope}.`,
            `⚠ THIS IS YOUR OWN SIDE ONLY, and it always is — a direction can only ever be filed against your own operator's machine, so there is nothing here about anybody else and no way to ask about one.`,
        ].join("\n"));
    }
    return (0, respond_1.ok)([
        `Your directions ${scope}, newest first:`,
        "",
        ...directions.map(renderDirection),
        "",
        `⚠ A row still reading **pending** or **claimed** has not been answered YET. Do not re-send it — a second direction says the same thing to a live agent twice.`,
        `⚠ AN ANSWER HERE IS THE FINAL TEXT OF ONE TURN, not the agent's narration and not its current state. For what an agent is DOING, dopl_channel(op="read_sessions").`,
    ].join("\n"));
}
