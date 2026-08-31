"use strict";
/**
 * `dopl_channel` op="launch_agent" — ASK THE OPERATOR'S OWN DESKTOP TO START AN
 * AGENT (Samuel's ruling, 2026-08-22: launch-over-MCP approved, with a LOCAL
 * DESKTOP TOGGLE as the consent).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 *
 * ── THE ONE THING EVERY LINE IN HERE HAS TO RESPECT ────────────────────────
 * **THIS OP ASKS. IT DOES NOT START ANYTHING.** Agents live in a desktop main
 * process no server can reach; what crosses the wire is a row in a mailbox that
 * the operator's machine polls, decides, and answers. Three consequences the
 * copy must carry rather than paper over:
 *   1. A REFUSAL IS A NORMAL OUTCOME, not an error — and one of the seven reasons
 *      (`no-bridge`) is the OPERATOR SAYING NO. It must never read as a fault or
 *      as something to retry.
 *   2. A TIMEOUT IS NOT A FAILURE. The directive stays pending and the machine
 *      may still take it. Re-issuing queues a SECOND agent, so the result says
 *      so in the strongest terms available.
 *   3. "launched" MEANS A MACHINE SAID SO. There is no third party to check it
 *      against, and the sentence does not pretend otherwise.
 *
 * ⚠ A DIRECTIVE IS NOT A MESSAGE (INVARIANTS §5) — no `seq`, so it can never end
 * an `await`. That is why this op holds on the ROW rather than telling the agent
 * to arm a wait.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opLaunchAgent = opLaunchAgent;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
/** Peer-influenced display text, neutralized — never an empty span. */
const NO_NAME = "(unnamed)";
/** The `code` a DoplApiError carries, or null. ⚠ Duck-typed rather than imported
 *  — the same discipline `respond.ts`'s `isNotFound` follows across the
 *  @dopl/client boundary. */
function apiErrorCode(e) {
    if (typeof e !== "object" || e === null)
        return null;
    const code = e.code;
    return typeof code === "string" && code.length > 0 ? code : null;
}
function templateMatches(e) {
    const details = e?.details;
    const raw = details?.matches;
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((m) => !!m && typeof m === "object")
        .map((m) => ({
        id: typeof m.id === "string" ? m.id : "",
        name: (0, channel_shared_1.inlineOr)(typeof m.name === "string" ? m.name : "", NO_NAME),
        visibility: typeof m.visibility === "string" ? m.visibility : "unknown",
    }))
        .filter((m) => m.id !== "");
}
/**
 * THE AMBIGUOUS-NAME REFUSAL — **it lists, and it does not pick.**
 *
 * ⚠ `agent_templates` HAS NO NAME UNIQUENESS, DELIBERATELY: a unique index
 * across a visibility boundary would leak the existence of somebody's private
 * row through a conflict error, and two people may each keep a "Researcher". So
 * two visible templates sharing a name is a LEGITIMATE state, and every natural
 * tie-break ("yours wins", "newest wins") silently starts an identity the caller
 * did not choose and reports success.
 *
 * ⚠ THE LIST IS THE WHOLE VALUE OF THE REFUSAL. "That name is ambiguous" alone
 * sends the agent to another tool to fetch ids it was already holding. Each row
 * carries the ID (what to re-issue with) and the VISIBILITY (what makes the
 * choice obvious — "the private one is mine").
 * ⚠ `isError`, because nothing was filed and there is nothing pending. An `ok`
 * result reading as a normal outcome would invite a poll for a directive that
 * does not exist.
 */
function ambiguousTemplate(ref, matches) {
    const label = (0, channel_shared_1.inlineOr)(ref, NO_NAME);
    if (matches.length === 0) {
        return (0, respond_1.err)(`No agent was requested — the template name \`${label}\` matches MORE THAN ONE template you can see, and nothing was started. Template names are deliberately not unique, so this call will not guess between them. List them with the agent-templates surface, then re-issue with the template's ID instead of its name.`);
    }
    return (0, respond_1.err)([
        `No agent was requested — the template name \`${label}\` matches ${matches.length} templates you can see, and **nothing was filed**. Template names are deliberately NOT unique (two members may each keep a "Researcher"), so this call refuses rather than picking one for you.`,
        `Re-issue with the ID of the one you meant:`,
        ...matches.map((m) => `- \`${m.id}\` — ${m.name} (${m.visibility})`),
        `⚠ Every template listed is one YOU can see. Whether the OPERATOR whose machine runs the agent can see it is a separate question, answered on their machine at start time.`,
    ].join("\n"));
}
/**
 * THE UNRESOLVABLE-TEMPLATE REFUSAL, at CREATE time.
 *
 * ⚠ DISTINCT FROM `no-template`, WHICH IS THE SAME FACT ON THE OTHER MACHINE.
 * This one is YOUR visibility failing, before any row exists; `no-template` is
 * the OPERATOR's failing, after the request was filed. The next actions differ —
 * here you fix the name, there you share the template or drop it — so they are
 * two sentences and not one.
 * ⚠ IT DOES NOT SAY WHETHER THE TEMPLATE EXISTS. The whole read surface is
 * 404-never-403 so an id cannot be probed, and a sentence that guessed would
 * rebuild that oracle.
 */
function templateNotFound(ref) {
    const label = (0, channel_shared_1.inlineOr)(ref, NO_NAME);
    return (0, respond_1.err)(`No agent was requested — no agent template \`${label}\` resolves for you, and **nothing was filed**. Either there is no such template, or it is not shared with you; those are ONE answer here on purpose, so ids cannot be probed. Check the exact name (matching is exact, not fuzzy) or launch without a template.`);
}
/** Default and cap for the bounded hold. ⚠ Mirrors `channel-schema.ts ›
 *  wait_ms`; the schema is what an MCP client sees, this is what runs. */
const WAIT_DEFAULT_MS = 15_000;
const WAIT_CAP_MS = 30_000;
/**
 * ⚠ COARSE, AND DELIBERATELY SO. The thing being waited on is a human-scale
 * toggle plus a process spawn on another machine; polling faster buys nothing
 * and multiplies requests across every armed launch in the workspace. 1.5s is
 * the same tick the await hold uses server-side.
 */
const POLL_INTERVAL_MS = 1_500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * THE REFUSAL CONTRACT, AS SENTENCES AN AGENT CAN ACT ON.
 *
 * ⚠ **THE WORD CROSSES THE WIRE, THE SENTENCE IS WRITTEN HERE** — the same split
 * `detail` takes, and for the same two reasons: prose on the wire needs a
 * DESKTOP RELEASE to reword, and desktop-authored text rendered into an MCP
 * result is text nobody neutralized. A value outside this map cannot arrive (the
 * column CHECK and the route enum both refuse it) and is rendered as an unknown
 * reason rather than as itself.
 *
 * ⚠ EACH SENTENCE ENDS IN WHAT TO DO, because a reason with no next action gets
 * an agent to retry the same call. And the three that are TEMPORARY say so
 * differently from the three that are not — retrying `cap` in a minute is
 * sensible, retrying `no-bridge` is asking a machine to change its owner's mind.
 */
const REFUSAL_SENTENCES = {
    // ⚠ THE CAP WORDING, and it is the one an orchestrator most needs to read
    // correctly: nothing is broken, the machine is FULL. The next action is to
    // wait for one of the running agents to finish — which `read_sessions` and the
    // session block on every await now show — not to re-issue.
    cap: "the machine is ALREADY RUNNING AS MANY AGENTS AS IT ALLOWS. Nothing is broken and nothing is wrong with your request — there is no free slot. Do not re-issue: check what is running with dopl_channel(op=\"read_sessions\"), and either wait for one of those to finish or ask your operator to end one.",
    busy: "the machine is under load and declined FOR NOW. This one is genuinely temporary — it is reasonable to ask again in a minute or two, once, and to stop if it refuses the same way twice.",
    "no-sdk": "that machine has NO AGENT RUNTIME available, so it cannot start one at all. Re-issuing will not change that. Tell your operator; it is a setup problem on their side.",
    "auth-hold": "the desktop is SIGNED OUT or its credential is being held, so it will not start anything until a human signs in. Tell your operator — this needs them, not another call.",
    // ⚠ THE CONSENT REFUSAL. It must not read as a fault, and it must not suggest
    // a workaround: the toggle is the operator's decision and the whole reason
    // this op was allowed to exist.
    "no-bridge": "your operator has LAUNCHING OVER MCP TURNED OFF on that machine. That is a deliberate setting, not a failure and not something to work around — it is how they consented (or did not) to this capability. If you believe they want it on, ASK THEM; do not re-issue, and do not look for another route to start an agent.",
    "no-counterparty": "there is nothing for an agent to work with in that channel. Check the channel with dopl_channel(op=\"members\") and op=\"list_threads\" before asking again.",
    // ⚠ THE AGENT-TEMPLATES WORD (2026-08-22). It says WHOSE VISIBILITY FAILED, because
    // the two fences on this lane belong to DIFFERENT PEOPLE: you named the template
    // under YOUR visibility at create time, and the desktop resolved it under the
    // OPERATOR's at spawn. A private template of yours is simply unusable over this lane
    // unless you ARE the operator, and an orchestrator that does not know that will
    // re-issue forever.
    // ⚠ IT DOES NOT SAY WHICH of deleted / invisible it was, and must not: the resolve
    // endpoint is 404-never-403 precisely so that difference is not observable, and a
    // sentence that guessed would rebuild the oracle the whole design closes.
    "no-template": "that machine could not resolve the TEMPLATE you named. Either it no longer exists, or it is not visible to the OPERATOR whose machine this is — you named it under YOUR visibility, and their desktop resolves it under THEIRS, so a private or team template of yours can be unusable there. Do not re-issue the same id: launch without a template, or share one that member can see.",
};
function refusalSentence(reason) {
    if (reason === null) {
        // ⚠ Reachable only if a machine wrote a refusal with no reason, which the
        // column's own CHECK forbids. Said honestly rather than guessed at.
        return "the machine refused and gave no reason. That should not happen; report it to your operator.";
    }
    return (REFUSAL_SENTENCES[reason] ??
        "the machine refused for a reason this build does not recognize. Report it to your operator rather than re-issuing.");
}
/** The line a PENDING (or expired) directive ends on. ⚠ Says the id, because the
 *  id is the only handle the agent has left, and says NOT to re-issue. */
function pendingLines(d, channelRef) {
    return [
        `The request is still PENDING — id \`${d.id}\`, and it stays answerable until ${d.expiresAt}.`,
        `⚠ A TIMEOUT IS NOT A REFUSAL. Your operator's machine may still take it; nothing has been cancelled. **DO NOT ISSUE THIS CALL AGAIN** — a second directive starts a SECOND agent on the same work, and you would have no way to tell them apart.`,
        `To find out what happened: dopl_channel(op="read_sessions", channel="${channelRef}"). A new agent appearing there is yours. If nothing shows up within a couple of minutes, the request lapsed and the machine never took it — tell your operator rather than retrying.`,
    ];
}
/**
 * ASK FOR AN AGENT, then hold briefly for the answer.
 *
 * ⚠ FOUR TERMINAL SHAPES, and each one ends in a different next action:
 * OFFLINE (nothing filed), LAUNCHED (an id to address), REFUSED (one of seven
 * sentences), PENDING/EXPIRED (the id, and an instruction not to re-issue).
 */
async function opLaunchAgent(client, ref, opts = {}) {
    // ⚠ PRE-RESOLVED, unlike the hot read paths: this op is cold (one call, then a
    // hold), and the result text names the channel repeatedly. Resolving once buys
    // a neutralized display name and a clean not-found instead of an opaque 404
    // out of the create.
    const channel = await (0, channel_shared_1.resolveChannelOr)(client, ref);
    if ((0, channel_shared_1.isErr)(channel))
        return channel;
    const label = (0, channel_shared_1.inlineOr)(channel.name, NO_NAME);
    let created;
    try {
        created = await client.createLaunchDirective({
            channel: channel.id,
            threadId: opts.thread,
            goal: opts.goal,
            model: opts.model,
            template: opts.template,
        });
    }
    catch (e) {
        // ⚠ THE TEMPLATE ARMS COME FIRST, AND THE DISCRIMINATOR IS THE **CODE**, NOT
        // THE STATUS. This one call now has two ways to 404 (no such channel /
        // membership, no such template) and one to 409, and a status-only branch
        // would tell an agent its CHANNEL was wrong when it was the template name —
        // the exact mis-narration `channel-errors.ts` exists to stop.
        if (apiErrorCode(e) === "AGENT_TEMPLATE_AMBIGUOUS") {
            return ambiguousTemplate(opts.template ?? "", templateMatches(e));
        }
        if (apiErrorCode(e) === "AGENT_TEMPLATE_NOT_FOUND") {
            return templateNotFound(opts.template ?? "");
        }
        if ((0, respond_1.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(ref);
        throw e;
    }
    // ── OFFLINE: nothing was filed, and the caveat is HONEST about what presence
    //    can and cannot tell us. ────────────────────────────────────────────────
    if (created.offline) {
        return (0, respond_1.ok)([
            `No agent was requested in **${label}** — your operator's machine is not reporting in, so there is nothing listening for a launch. **No request was filed**, so there is nothing pending and nothing to cancel.`,
            `⚠ THIS IS A HINT, NOT A VERDICT ON A PARTICULAR MACHINE. What was checked is a per-(user, workspace) presence heartbeat: it says no listener of your operator's has checked in recently. It cannot tell you WHICH of their machines is up, whether the one that would run this agent is up, or whether launching over MCP is even enabled there.`,
            `Most likely the machine is asleep, closed, or signed out. Ask your operator to open Dopl, then try again — or do the work yourself and post the result with dopl_channel(op="post", channel="${ref}", ...).`,
        ].join("\n"));
    }
    let directive = created.directive;
    const waitMs = Math.min(opts.waitMs ?? WAIT_DEFAULT_MS, WAIT_CAP_MS);
    const deadline = Date.now() + waitMs;
    // ⚠ POLLS THE ROW, never an `await`: a directive is not a message, has no
    // `seq`, and can never end a message hold.
    while ((directive.status === "pending" || directive.status === "claimed") &&
        Date.now() < deadline) {
        await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
        try {
            directive = await client.getLaunchDirective(directive.id);
        }
        catch {
            // ⚠ A FAILED POLL DOES NOT DESTROY THE HOLD OR THE DIRECTIVE. The request
            // is filed and the machine may still take it, so the honest ending is the
            // PENDING one — which tells the agent where to look. Throwing here would
            // report a failure over a launch that may well be running.
            break;
        }
    }
    if (directive.status === "launched" && directive.agentId) {
        const on = directive.threadId
            ? ` on thread \`${directive.threadId}\``
            : ` in the main room`;
        // ⚠ THE GOAL CLAUSE BRANCHES, AND THAT IS THE 2026-08-31 CORRECTION. A
        // directive carrying a goal now starts a session that RUNS it as its first
        // instruction (`main/launch-directives.js › spawn`, `idle: !goal`); a
        // directive with NO goal registers a stand-by agent that runs nothing until a
        // PERSON talks to it. Those are different outcomes and the caller acts on the
        // difference — "it is on it" vs "it is parked and you cannot start it" — so
        // one sentence covering both would have to be the weaker claim, and the
        // weaker one is wrong in the direction that leaves an orchestrator waiting.
        const goalGiven = typeof opts.goal === "string" && opts.goal.trim() !== "";
        const started = goalGiven
            ? `Its FIRST INSTRUCTION is the \`goal\` you sent — that machine is working on it now, so there is nothing further to send to get it going.`
            : `⚠ YOU SENT NO \`goal\`, SO IT IS STANDING BY AND IS RUNNING NOTHING. It starts on the first message that names it; see the handle below. If you meant it to work now, a launch WITH a goal is one call instead of two.`;
        return (0, respond_1.ok)([
            `Agent **${directive.agentId}** was started in **${label}**${on}. ${started}`,
            // ── ⚠ THE ADDRESS, AND THE THREE LIMITS THAT USED TO BE MISSING ──────
            // This line said: "DIRECT IT WITH `@<id>` — write that token in the BODY
            // of a post into this channel, and that specific agent picks it up." The
            // sentence was RIGHT and the surface underneath it was not: the loop
            // fence refused every agent-authored message, so the only caller that
            // held the id could not spend it, and a live orchestrator followed this
            // copy five times into silence (ENGINEERING, 2026-08-31). Samuel's
            // same-account carve made the sentence true; what it never had, and has
            // now, is the boundary — addressed only, own operator only, unobservable.
            `ITS HANDLE IS \`@agent-${directive.agentId}\` — that exact form, prefixed, which is what the Dopl app writes and tints. A friendly NAME your operator may give it lives on their machine alone and is never addressable from here.`,
            `TO REDIRECT IT LATER, write \`@agent-${directive.agentId}\` in the BODY of a post into this channel (thread it with the same thread id if it has one). That is the ONE case where a handle addresses an agent rather than a person: the token is parsed on your operator's machine, not by the server's mention resolver, so it stamps nobody and lands in no Tags inbox. ⚠ THREE LIMITS, AND THEY ARE THE FENCE RATHER THAN A KNACK: it must NAME the agent (an unaddressed post of yours starts nobody, whatever it says); it works only for YOUR OWN operator's agents, because you post under their account and no post of yours can start anything on another member's machine; and the wake happens on a desktop this server cannot see, so nothing here confirms it landed.`,
            `⚠ IT IS NOT YOUR SESSION AND YOU CANNOT SEE INSIDE IT. What comes back to you are its POSTS and its milestones, in this channel — arm dopl_channel(op="await", channel="${ref}", since=<your cursor>) to receive them, or omit \`channel\` to watch every channel you are in at once. Its live state shows up in dopl_channel(op="read_sessions"), which also prints each session's addressable handle.`,
            `⚠ "Started" means THE MACHINE SAID SO. There is no second source to confirm it against — if nothing appears in read_sessions and nothing is posted, say that rather than assuming it is working.`,
        ].join("\n"));
    }
    if (directive.status === "refused") {
        return (0, respond_1.ok)([
            `No agent was started in **${label}** — your operator's machine REFUSED the request, and ${refusalSentence(directive.refusalReason)}`,
            `⚠ A refusal is a normal answer from a machine its owner controls, not an error and not a bug in your request. Nothing is pending; there is nothing to cancel and nothing to wait for.`,
            `You can still do the work yourself and post the result with dopl_channel(op="post", channel="${ref}", ...).`,
        ].join("\n"));
    }
    // PENDING, CLAIMED (taken but not yet answered) or EXPIRED all end here: the
    // agent's next action is identical, and the id is the handle.
    if (directive.status === "expired") {
        return (0, respond_1.ok)([
            `No agent was started in **${label}** — the request LAPSED before any machine answered it (id \`${directive.id}\`). Most often that means the desktop was asleep or had launching over MCP turned off.`,
            `Nothing is pending now. You may ask once more if you have reason to think the machine is up — dopl_channel(op="read_sessions") will show you whether anything of yours is running there — otherwise tell your operator and do the work yourself.`,
        ].join("\n"));
    }
    const claimed = directive.status === "claimed"
        ? ` A machine has TAKEN it and is working on it, so it is likely to land shortly.`
        : "";
    return (0, respond_1.ok)([
        `No answer yet from your operator's machine about starting an agent in **${label}**.${claimed}`,
        ...pendingLines(directive, ref),
    ].join("\n"));
}
