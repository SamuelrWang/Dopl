"use strict";
/**
 * `dopl_channel` op="manage" action="launch" — asks the operator's own desktop to start an agent.
 * This op asks, it starts nothing: a refusal is a normal answer, and a timeout is not a failure
 * (re-issuing without the same `client_msg_id` queues a second agent).
 * A directive is not a message (no `seq`, INVARIANTS §5), so the op holds on the row (`holdRow`).
 * `channel-` filename prefix is required by the parity split-scan (`tool-group-files.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opLaunchAgent = opLaunchAgent;
exports.identityMatches = identityMatches;
exports.launchIdentityAmbiguous = launchIdentityAmbiguous;
exports.identityElsewhere = identityElsewhere;
exports.launchIdentityNotFound = launchIdentityNotFound;
const respond_1 = require("./respond");
const channel_directive_hold_1 = require("./channel-directive-hold");
const channel_shared_1 = require("./channel-shared");
const channel_facts_1 = require("./channel-facts");
const channel_ops_launch_color_1 = require("./channel-ops-launch-color");
const agent_shared_1 = require("./agent-shared");
// One wording of the tenancy rule, shared with the doctrine.
const channel_doctrine_1 = require("./channel-doctrine");
const narration_1 = require("./narration");
const channel_ops_launch_name_1 = require("./channel-ops-launch-name");
const channel_ops_launch_goal_1 = require("./channel-ops-launch-goal");
const channel_errors_1 = require("./channel-errors");
/**
 * Ask for an agent, then hold briefly for the answer.
 * Terminal shapes: offline (nothing filed), launched, refused (reason + `retry=`), pending / expired.
 */
async function opLaunchAgent(client, ref, opts = {}) {
    const named = (0, channel_ops_launch_name_1.launchName)(opts.name);
    if ((0, channel_ops_launch_name_1.isNameRefusal)(named))
        return named;
    // Runs before `resolveChannelOr`: a refusal that needs no round trip must not cost one.
    const goal = (0, channel_ops_launch_goal_1.launchGoal)(opts.goal);
    if ((0, channel_ops_launch_goal_1.isGoalRefusal)(goal))
        return goal;
    const channel = await (0, channel_shared_1.resolveChannelOr)(client, ref);
    if ((0, channel_shared_1.isErr)(channel))
        return channel;
    let created;
    try {
        created = await client.createLaunchDirective({
            channel: channel.id,
            threadId: opts.thread,
            goal: goal.goal,
            model: opts.model,
            // `runtime` / `identity` / posture / `color` pass through untouched: only the server or the
            // operator's machine can judge them, never this process.
            runtime: opts.runtime,
            identity: opts.identity,
            tools: opts.tools,
            messages: opts.messages,
            chain: opts.chain,
            clientMsgId: opts.clientMsgId,
            color: opts.color,
            agentName: named.name,
        });
    }
    catch (e) {
        // Discriminate on `code`, not status: two codes share 409 (colour taken, ambiguous identity)
        // and two share 404 (channel, identity).
        if ((0, respond_1.apiErrorCode)(e) === "AGENT_COLOR_TAKEN") {
            return (0, channel_ops_launch_color_1.colorTaken)(opts.color ?? "", (0, channel_ops_launch_color_1.freeColors)(e));
        }
        if ((0, respond_1.apiErrorCode)(e) === agent_shared_1.IDENTITY_AMBIGUOUS_CODE) {
            return launchIdentityAmbiguous(opts.identity ?? "", identityMatches(e));
        }
        if ((0, respond_1.apiErrorCode)(e) === agent_shared_1.IDENTITY_NOT_FOUND_CODE) {
            return launchIdentityNotFound(opts.identity ?? "", identityElsewhere(e));
        }
        // Any other 400 is classified, and `serverDetail` names the refused field; nothing was filed.
        if ((0, channel_errors_1.isBadRequest)(e) && (0, channel_errors_1.classifyBadRequest)(e) === "invalid_request") {
            return (0, respond_1.err)(`No agent was requested — that launch was rejected as INVALID before any directive was filed, and **nothing is pending**. This is NOT a membership, identity or colour problem, so do not invite anyone, re-pick an identity or change \`color\` over it.${(0, channel_errors_1.serverDetail)(e)} ${(0, channel_errors_1.fieldCapsNote)()} Fix the field the server named and ask again.`);
        }
        if ((0, respond_1.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(ref);
        throw e;
    }
    if (created.offline) {
        // Nothing was filed, so nothing is pending. Presence is a per-(user, workspace) hint, not a verdict.
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("not launched", { reason: "offline", filed: false, retry: "no" }));
    }
    let directive = created.directive;
    // Spread LAST on every shape so `retry=existing` wins; `existing` is absent on an older server.
    const converged = created.existing ? { retry: "existing" } : {};
    directive = await (0, channel_directive_hold_1.holdRow)(directive, (id) => client.getLaunchDirective(id), opts.waitMs);
    if (directive.status === "launched" && directive.agentId) {
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("launched", {
            agent: `@agent-${directive.agentId}`,
            // The machine's `appliedAgentName`, never the request: a taken name is stored `-1`.
            name: (0, channel_ops_launch_name_1.launchedName)(directive.appliedAgentName),
            thread: directive.threadId ?? undefined,
            identity: directive.identityName ?? undefined,
            model: directive.model ?? undefined,
            ...(0, channel_facts_1.runtimeFacts)(directive),
            // `idle=yes` = a stand-by agent running nothing. Read off the directive row, not this call's
            // args: a converged retry returns the first request's row.
            idle: !directive.goal?.trim(),
            ...(0, channel_facts_1.postureFacts)(directive),
            ...converged,
        }));
    }
    if (directive.status === "refused") {
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("refused", {
            reason: directive.refusalReason ?? undefined,
            // No reason (the column CHECK forbids it) prints `-`, never a guessed verdict.
            retry: directive.refusalReason
                ? channel_directive_hold_1.LAUNCH_RETRY_ADVICE[directive.refusalReason]
                : undefined,
            filed: true,
            ...converged,
        }));
    }
    if (directive.status === "expired") {
        // No machine ever answered, so asking once more is legitimate (`LAUNCH_RETRY_ADVICE`'s `once`).
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("expired", {
            directive: directive.id,
            filed: true,
            retry: "once",
            ...converged,
        }));
    }
    // Pending or claimed: `retry=no`, because re-issuing starts a second agent on the same work.
    return (0, respond_1.ok)((0, channel_facts_1.factsLine)("pending", {
        directive: directive.id,
        claimed: directive.status === "claimed",
        expires: directive.expiresAt,
        retry: false,
        ...converged,
    }));
}
function identityMatches(e) {
    const details = e?.details;
    const raw = details?.matches;
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((m) => !!m && typeof m === "object")
        .map((m) => ({
        id: typeof m.id === "string" ? m.id : "",
        name: (0, channel_shared_1.inlineOr)(typeof m.name === "string" ? m.name : "", narration_1.NO_NAME),
        visibility: typeof m.visibility === "string" ? m.visibility : "unknown",
    }))
        .filter((m) => m.id !== "");
}
/**
 * Lists the matches and never picks: identity names are deliberately not unique (a unique index would
 * leak private rows). `err`, because nothing was filed.
 */
function launchIdentityAmbiguous(ref, matches) {
    const label = (0, channel_shared_1.inlineOr)(ref, narration_1.NO_NAME);
    if (matches.length === 0) {
        return (0, respond_1.err)(`No agent was requested — the identity name \`${label}\` matches MORE THAN ONE identity you can see, and nothing was started. Identity names are deliberately not unique, so this call will not guess between them. List them with the agent-identities surface, then re-issue with the identity's ID instead of its name.`);
    }
    return (0, respond_1.err)([
        `No agent was requested — the identity name \`${label}\` matches ${matches.length} identities you can see, and **nothing was filed**. Identity names are deliberately NOT unique (two members may each keep a "Researcher"), so this call refuses rather than picking one for you.`,
        `Re-issue with the ID of the one you meant:`,
        ...(0, agent_shared_1.identityChoiceLines)(matches),
        `⚠ Every identity listed is one YOU can see. Whether the OPERATOR whose machine runs the agent can see it is a separate question, answered on their machine at start time.`,
    ].join("\n"));
}
function identityElsewhere(e) {
    const details = e?.details;
    const raw = details?.elsewhere;
    if (!raw || typeof raw !== "object")
        return null;
    const { name, label } = raw;
    if (typeof name !== "string" || typeof label !== "string")
        return null;
    if (name === "" || label === "")
        return null;
    return { name, label };
}
/**
 * The caller's own visibility failing at create time (`no-identity` is the operator's, after filing).
 * Never says whether the identity exists (404-never-403). A NAME resolves only in the channel's
 * container, while an ID resolves wherever it lives (`src/features/agent-identities/server/service-resolve-ref.ts ›
 * resolveIdentityRef`); `details.elsewhere` is fenced by `classifyMissingIdentityRef` to identities the caller could already list.
 */
function launchIdentityNotFound(ref, elsewhere) {
    if (elsewhere) {
        return (0, respond_1.err)([
            // `inlineOr` already returns a code span, so no backticks of our own.
            `No agent was requested, and **nothing was filed** — identity ${(0, channel_shared_1.inlineOr)(elsewhere.name, narration_1.NO_NAME)} lives in ${(0, channel_shared_1.inlineOr)(elsewhere.label, "another tenancy of yours")}, not in this channel's own container.`,
            `⚠ ${channel_doctrine_1.TENANCY_RULE} Owning it is not enough; it has to live here. ${(0, channel_doctrine_1.tenancyFix)()}`,
        ].join("\n"));
    }
    return (0, respond_1.err)([
        // True of a name; the ID case is stated by `TENANCY_RULE`.
        `No agent was requested — no agent identity ${(0, channel_shared_1.inlineOr)(ref, narration_1.NO_NAME)} resolves in THIS CHANNEL'S container, and **nothing was filed**. Either there is no such identity, or it is not shared with you; those are ONE answer here on purpose, so ids cannot be probed.`,
        `⚠ CHECK THE TENANCY BEFORE THE SPELLING. ${channel_doctrine_1.TENANCY_RULE} If it really should resolve here, the NAME is the other suspect — matching is exact, not fuzzy. ${(0, channel_doctrine_1.tenancyFix)()}`,
    ].join("\n"));
}
