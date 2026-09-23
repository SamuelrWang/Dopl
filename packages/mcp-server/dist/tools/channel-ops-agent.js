"use strict";
/**
 * `dopl_channel` op="manage" action="end" / "rename" for the operator's own running agents.
 * Management ops are directives: they ask, the operator's machine answers, and the row is held via `holdRow`.
 * The launch-consent toggle does not gate end/rename, so no copy here may tell a caller to turn it on.
 * The `channel-` filename prefix is load-bearing for the parity scans (`tool-group-files.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pendingFacts = pendingFacts;
exports.fileAndHold = fileAndHold;
exports.opEndAgent = opEndAgent;
exports.opRenameAgent = opRenameAgent;
const respond_1 = require("./respond");
const channel_directive_hold_1 = require("./channel-directive-hold");
const channel_shared_1 = require("./channel-shared");
const agent_display_name_1 = require("./agent-display-name");
const channel_agent_target_1 = require("./channel-agent-target");
const channel_facts_1 = require("./channel-facts");
/** Past-tense verb per kind — a map over the kind, never a ternary (F-413). */
const VERB_PAST = {
    end: "ended",
    rename: "renamed",
    set_agent_mode: "re-postured",
};
/** The surface that can confirm each kind: only an end shows in `status`; rename and posture live on the operator's machine. */
const PENDING_CONFIRM = {
    end: "status",
    rename: "none",
    set_agent_mode: "none",
};
/** Keyed on the kind, never a display word. `retry=no`: a second directive is a second request for the same change. */
function pendingFacts(d, kind) {
    return {
        directive: d.id,
        claimed: d.status === "claimed",
        expires: d.expiresAt,
        retry: false,
        confirm: PENDING_CONFIRM[kind],
    };
}
/**
 * File the directive and hold it (`holdRow`) — plumbing shared with `channel-ops-agent-mode.ts`, which writes its own sentences.
 * A 404 on create is the channel, never the agent.
 */
async function fileAndHold(client, ref, input, waitMs) {
    let created;
    try {
        created = await client.createAgentDirective(input);
    }
    catch (e) {
        if ((0, respond_1.apiErrorCode)(e) === "CHANNEL_AGENT_FOREIGN") {
            return {
                done: true,
                response: (0, channel_agent_target_1.foreignAgent)(input.agentId, VERB_PAST[input.kind]),
            };
        }
        if ((0, respond_1.isNotFound)(e))
            return { done: true, response: (0, channel_shared_1.channelNotFound)(ref) };
        throw e;
    }
    if (created.offline) {
        return {
            done: true,
            offline: true,
            // filed=no: nothing was written, so nothing is pending. Presence is a hint, not a verdict.
            response: (0, respond_1.ok)(
            // The verb comes from VERB_PAST, never a ternary (F-413).
            (0, channel_facts_1.factsLine)(`not ${VERB_PAST[input.kind]}`, {
                agent: `@agent-${input.agentId}`,
                reason: "offline",
                filed: false,
            })),
        };
    }
    return {
        done: false,
        directive: await (0, channel_directive_hold_1.holdRow)(created.directive, (id) => client.getLaunchDirective(id), waitMs),
    };
}
/** End one of the operator's own running agents. A stop verb: no thread or message is touched. */
async function opEndAgent(client, ref, agentId, opts = {}) {
    // Target checked before the channel lookup: a refusal needing no round trip must not cost one.
    const target = (0, channel_agent_target_1.agentTarget)(agentId);
    if ((0, channel_agent_target_1.isAgentTargetRefusal)(target))
        return target;
    const agent = target.agent;
    const channel = await (0, channel_shared_1.resolveChannelOr)(client, ref);
    if ((0, channel_shared_1.isErr)(channel))
        return channel;
    const filed = await fileAndHold(client, ref, { kind: "end", channel: channel.id, agentId: agent }, opts.waitMs);
    if (filed.done)
        return filed.response;
    const d = filed.directive;
    // handle=spent: instance ids are never reused, so the handle now addresses nobody.
    if (d.status === "done") {
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("ended", { agent: `@agent-${agent}`, handle: "spent", filed: true }));
    }
    if (d.status === "refused") {
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("not ended", {
            agent: `@agent-${agent}`,
            reason: d.refusalReason ?? undefined,
            // `-` when the machine named no reason, never a guessed verdict.
            retry: d.refusalReason ? channel_directive_hold_1.LAUNCH_RETRY_ADVICE[d.refusalReason] : undefined,
            filed: true,
        }));
    }
    if (d.status === "expired") {
        // Lapsed is not refused: nothing is outstanding. Check op="status" before asking again.
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("not ended", {
            agent: `@agent-${agent}`,
            directive: d.id,
            reason: "expired",
            filed: true,
        }));
    }
    return (0, respond_1.ok)((0, channel_facts_1.factsLine)("pending", { agent: `@agent-${agent}`, ...pendingFacts(d, "end") }));
}
/** Rename one of the operator's own agents: display-only, on one machine; nothing resolves an agent by name. An empty name clears. */
async function opRenameAgent(client, ref, agentId, name, opts = {}) {
    // Same target check as opEndAgent.
    const target = (0, channel_agent_target_1.agentTarget)(agentId);
    if ((0, channel_agent_target_1.isAgentTargetRefusal)(target))
        return target;
    const agent = target.agent;
    const channel = await (0, channel_shared_1.resolveChannelOr)(client, ref);
    if ((0, channel_shared_1.isErr)(channel))
        return channel;
    // A slug is normalized to a display name; the measured string is filed and reported.
    const display = (0, agent_display_name_1.agentDisplayName)(name);
    const clearing = display === "";
    const filed = await fileAndHold(client, ref, { kind: "rename", channel: channel.id, agentId: agent, name: display }, opts.waitMs);
    if (filed.done)
        return filed.response;
    const d = filed.directive;
    // handle=unchanged: `@agent-<id>` stays the only address. confirm=none: the name never reaches a server.
    if (d.status === "done") {
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("renamed", {
            agent: `@agent-${agent}`,
            // Cleared falls back to `Agent #<id>`, which is not "unnamed".
            name: clearing ? "cleared" : display,
            handle: "unchanged",
            confirm: "none",
        }));
    }
    if (d.status === "refused") {
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("not renamed", {
            agent: `@agent-${agent}`,
            reason: d.refusalReason ?? undefined,
            retry: d.refusalReason ? channel_directive_hold_1.LAUNCH_RETRY_ADVICE[d.refusalReason] : undefined,
            agentChanged: false,
        }));
    }
    if (d.status === "expired") {
        return (0, respond_1.ok)((0, channel_facts_1.factsLine)("not renamed", {
            agent: `@agent-${agent}`,
            directive: d.id,
            reason: "expired",
            agentChanged: false,
        }));
    }
    return (0, respond_1.ok)((0, channel_facts_1.factsLine)("pending", { agent: `@agent-${agent}`, ...pendingFacts(d, "rename") }));
}
