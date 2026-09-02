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
// ⚠ ONE write-result renderer, shared with `post` / `create_thread` / launch.
const channel_facts_1 = require("./channel-facts");
// ⚠ THE SHARED INSTANCE-ID PARSER (2026-09-01). It LIVED here until `end_agent`
// and `rename_agent` became its second and third callers; the whole argument for
// why four characters of logic still deserve one home is in that module.
const channel_agent_id_1 = require("./channel-agent-id");
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
/**
 * MAY THE CALLER ASK AGAIN? — ⚠ the ONE thing a refusal is read for, kept as a
 * field where the sentence became doctrine (T10, 2026-09-02).
 *
 * ⚠ THE WORD STILL CROSSES THE WIRE AND IS STILL RENDERED AS THE WORD. What left
 * is the paragraph per word: those are in `channel-doctrine.ts`'s WHY A LAUNCH,
 * END, DIRECTION OR RENAME IS REFUSED section, which covers both mailboxes with
 * one text — the two enums overlap on four of five words, and two copies of the
 * same explanation is how they drift apart.
 *
 * ⚠ `busy` IS THE ONLY TEMPORARY ONE, exactly as on the launch lane. Everything
 * else means the answer will not change: `no-session` is normally TRUE rather
 * than broken (the agent finished), and `no-bridge` is a setting nobody here may
 * work around.
 */
const RETRY_ADVICE = {
    "no-session": "no",
    "auth-hold": "no",
    busy: "once",
    blocked: "no",
    "no-bridge": "no",
};
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
    // ⚠ THE CHANNEL NAME IS NO LONGER RENDERED. Every result below is a fact line
    // keyed on the AGENT, which is what the caller acts on; the channel is the
    // caller's own argument from this call and repeating it back bought nothing.
    const agent = (0, channel_agent_id_1.bareAgentId)(agentId);
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
        // ⚠ `filed=no` IS THE LOAD-BEARING HALF — nothing was written, so there is
        // nothing pending and nothing to cancel, the opposite of the PENDING shape.
        // ⚠ PRESENCE IS A HINT, NOT A VERDICT: a per-(user, workspace) heartbeat
        // cannot say WHICH machine is up or whether directing is enabled there. The
        // doctrine says so; the fact is that no listener has checked in.
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("not delivered", {
            agent: `@agent-${agent}`,
            reason: "offline",
            filed: false,
        }));
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
        // ── THE RESULT: A FACT LINE, PLUS THE REPLY IF THERE IS ONE ──────────────
        //
        // ⚠ THE 300-CHAR WRITE-RESULT BUDGET IS OVER THE FACT LINE, NOT OVER THIS
        // WHOLE RESULT, and that is not a loophole. Every other write result is
        // *narration* about a write, which is why it can be capped; this one carries
        // a PAYLOAD the caller asked for and cannot get anywhere else — a direction
        // is not a channel message, so `read`/`await` will never show it. Clipping
        // the reply would delete the value of the call.
        //
        // ⚠ WHAT LEFT IS THE NARRATION AROUND IT: that the direction was private,
        // that the answer is private too, and that what comes back is one turn's
        // FINAL TEXT and not the agent's narration. All three are true of every
        // direction and are in `channel-doctrine.ts`.
        const head = (0, channel_facts_1.factsLine)("delivered", {
            agent: `@agent-${direction.agentId}`,
            // ⚠ `reply=none-reported` IS NOT "IT SAID NOTHING", and the difference is
            // stated because an orchestrator that reads one as the other concludes its
            // agent is broken. Either the turn's final text was empty, or that desktop
            // predates the answer-reporting build — and this cannot tell which.
            reply: direction.reply ? "below" : "none-reported",
        });
        return (0, respond_1.ok)(direction.reply
            ? [head, "", "Its answer:", "", direction.reply].join("\n")
            : head);
    }
    if (direction.status === "refused") {
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("refused", {
            agent: `@agent-${direction.agentId}`,
            reason: direction.refusalReason ?? undefined,
            // ⚠ `-` WHEN THE MACHINE NAMED NO REASON, never a guessed verdict.
            retry: direction.refusalReason
                ? RETRY_ADVICE[direction.refusalReason]
                : undefined,
            filed: true,
        }));
    }
    if (direction.status === "expired") {
        // ⚠ LAPSED IS NOT REFUSED: no machine ever answered. Asking again is
        // legitimate — but check the agent is running first, because a direction to
        // an agent that has since ended will lapse again.
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("expired", {
            agent: `@agent-${direction.agentId}`,
            direction: direction.id,
            filed: true,
        }));
    }
    // PENDING and CLAIMED both end here — the next action is identical.
    //
    // ⚠ **DO NOT ISSUE THIS CALL AGAIN** could not become a bare fact and did not:
    // a second direction says the same thing to a LIVE agent twice and it answers
    // twice, with no way for either side to tell which answer belonged to which.
    // `retry=no` is the instruction; `poll=` is what to do instead, and it is the
    // ONLY place a timed-out direction's answer can be picked up.
    return (0, respond_1.ok)((0, channel_facts_1.factsLine)("pending", {
        agent: `@agent-${direction.agentId}`,
        direction: direction.id,
        claimed: direction.status === "claimed",
        expires: direction.expiresAt,
        retry: false,
        poll: "read_directions",
    }));
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
        // ⚠ THE WORD, AND WHETHER TO ASK AGAIN. The sentence per word is in
        // `channel-doctrine.ts` — this is a LISTING, so a paragraph per row would
        // repeat the same five explanations down the page.
        const reason = d.refusalReason;
        return [
            head,
            body,
            `  - refused: ${reason ?? "(no reason reported)"}${reason ? ` · retry ${RETRY_ADVICE[reason]}` : ""}`,
        ].join("\n");
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
        agent: opts.agent ? (0, channel_agent_id_1.bareAgentId)(opts.agent) : undefined,
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
