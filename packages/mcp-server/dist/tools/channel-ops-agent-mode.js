"use strict";
/**
 * `dopl_channel` op="manage" action="posture": a management directive (held on the row via `holdRow`) asking that a running agent be re-postured.
 * It asks, never widens: the operator's machine clamps to its hand-set ceiling (`directive-agent-ops.js › setAgentMode`).
 * A null applied mode means "not reported" (older desktop), never "unclamped" (`channel-facts.ts › postureFacts`).
 * Unlike end/rename this kind IS gated by the launch-consent toggle, so `no-bridge` may mean the toggle is off.
 * The `channel-` filename prefix is load-bearing for the parity scans (`tool-group-files.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opSetAgentMode = opSetAgentMode;
const channel_directive_hold_1 = require("./channel-directive-hold");
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
const channel_agent_target_1 = require("./channel-agent-target");
const channel_ops_agent_1 = require("./channel-ops-agent");
const channel_facts_1 = require("./channel-facts");
const channel_facts_2 = require("./channel-facts");
/** What was asked, rendered; `-` for an axis left alone. */
function asked(tools, messages) {
    return `${tools ?? "-"}/${messages ?? "-"}`;
}
/**
 * Per agent, never per thread — no oldest-agent fallback.
 * "At least one axis" is checked in `channel-dispatch-agents.ts`, then by the route and the column CHECK.
 */
async function opSetAgentMode(client, ref, agentId, modes, opts = {}) {
    // Target checked before the channel lookup: a refusal needing no round trip must not cost one.
    const target = (0, channel_agent_target_1.agentTarget)(agentId);
    if ((0, channel_agent_target_1.isAgentTargetRefusal)(target))
        return target;
    const agent = target.agent;
    const channel = await (0, channel_shared_1.resolveChannelOr)(client, ref);
    if ((0, channel_shared_1.isErr)(channel))
        return channel;
    const want = asked(modes.tools, modes.messages);
    const filed = await (0, channel_ops_agent_1.fileAndHold)(client, ref, {
        kind: "set_agent_mode",
        channel: channel.id,
        agentId: agent,
        tools: modes.tools,
        messages: modes.messages,
    }, opts.waitMs);
    if (filed.done)
        return filed.response;
    const d = filed.directive;
    // `taken`, not `set`: the machine applied something, not necessarily what was asked; `asked=` beside `posture=` shows the gap.
    if (d.status === "done") {
        return (0, respond_1.ok)((0, channel_facts_2.factsLine)("taken", {
            agent: `@agent-${agent}`,
            asked: want,
            ...(0, channel_facts_1.postureFacts)(d),
            filed: true,
        }));
    }
    if (d.status === "refused") {
        return (0, respond_1.ok)((0, channel_facts_2.factsLine)("not re-postured", {
            agent: `@agent-${agent}`,
            asked: want,
            reason: d.refusalReason ?? undefined,
            // `-` when the machine named no reason, never a guessed verdict.
            retry: d.refusalReason ? channel_directive_hold_1.LAUNCH_RETRY_ADVICE[d.refusalReason] : undefined,
            filed: true,
        }));
    }
    if (d.status === "expired") {
        // Lapsed is not refused: nothing is outstanding and the agent keeps its posture.
        return (0, respond_1.ok)((0, channel_facts_2.factsLine)("not re-postured", {
            agent: `@agent-${agent}`,
            asked: want,
            directive: d.id,
            reason: "expired",
            filed: true,
        }));
    }
    return (0, respond_1.ok)((0, channel_facts_2.factsLine)("pending", {
        agent: `@agent-${agent}`,
        asked: want,
        ...(0, channel_ops_agent_1.pendingFacts)(d, "set_agent_mode"),
    }));
}
