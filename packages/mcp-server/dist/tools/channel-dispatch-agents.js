"use strict";
/**
 * THE SIX AGENT-LIFECYCLE OPS OF `dopl_channel`, DISPATCHED — `direct_agent`,
 * `read_directions`, `launch_agent`, `end_agent`, `rename_agent` and
 * `set_agent_mode`.
 *
 * ⚠ SPLIT OUT OF `channel.ts` ON 2026-09-01, when integrating four tiers pushed
 * that file to 551 over the §1 cap of 500 (`set_agent_mode` from the
 * orchestrator-surface tier, `ping`/`pings` from the needs-you-ping tier). The
 * seam is not arithmetic: these six are the ops that ASK THE OPERATOR'S OWN
 * MACHINE to do something. Each files a directive and holds for an answer, each
 * can come back `refused` out of one closed vocabulary, and no other op on this
 * tool reads that vocabulary at all.
 *
 * 🔒 **IT TAKES `args` AND `client` AND NOTHING ELSE, AND THAT IS THE FENCE
 * RESTATED RATHER THAN A CONVENIENCE.** None of the six reads the caller
 * identity, the runtime stamp, the admin flag or the container lock: an agent
 * verb reaches the caller's OWN operator BY CONSTRUCTION, because the server
 * stamps the authenticated caller and there is no argument on this lane that
 * could name anybody else. ⚠ Adding a parameter here is how that stops being
 * true, so a widening needs the argument for why, in writing.
 *
 * ⚠ THE `op` UNION IS NARROWED BY THE CALLER'S GROUPED `case`, so this switch is
 * exhaustive over exactly those six and needs no `default`. `channel.ts`'s own
 * switch has no `default` either — its exhaustiveness over the whole op union is
 * what proves the handler always returns — and delegating a GROUP rather than
 * six one-liners keeps that property on both sides.
 *
 * ⚠ `channel-` filename prefix is REQUIRED: the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`channel-law.test.ts`, `law-scan.test.ts`) read every non-test `channel-*.ts`
 * in this directory.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchAgentOp = dispatchAgentOp;
const respond_1 = require("./respond");
const channel_ops_direct_1 = require("./channel-ops-direct");
const channel_ops_launch_1 = require("./channel-ops-launch");
const channel_ops_agent_1 = require("./channel-ops-agent");
const channel_ops_agent_mode_1 = require("./channel-ops-agent-mode");
/**
 * ⚠ **`op` IS PASSED SEPARATELY FROM `args`, AND IT IS NOT REDUNDANT.**
 * `CHANNEL_INPUT_SHAPE` is ONE object type with an `op` enum, not a
 * discriminated union, so the caller's grouped `case` narrows `args.op` but NOT
 * `args` — TypeScript has nothing to discriminate on. Taking the narrowed op as
 * its own parameter carries that narrowing across the call, which is what makes
 * the switch below exhaustive over exactly six words and lets this function
 * return without a `default` that could only throw.
 */
async function dispatchAgentOp(op, args, client) {
    switch (op) {
        case "direct_agent": {
            const miss = (0, respond_1.missingParams)("direct_agent", args, [
                "channel",
                "agent_id",
                "body",
            ]);
            if (miss)
                return miss;
            return (0, channel_ops_direct_1.opDirectAgent)(client, args.channel, args.agent_id, args.body, 
            // ⚠ `client_msg_id` IS THE SHARED PARAM, NOT A SECOND ONE (A10/G10,
            // 2026-09-02). The same field `post` and `create_thread` already take,
            // carrying the same promise on a third lane: re-sending one returns the
            // stored row instead of filing a second. A per-op spelling would be a
            // second idempotency vocabulary on one tool.
            { thread: args.thread, clientMsgId: args.client_msg_id, waitMs: args.wait_ms });
        }
        case "read_directions":
            return (0, channel_ops_direct_1.opReadDirections)(client, {
                channel: args.channel,
                agent: args.agent_id,
            });
        // ⚠ ASKS THE OPERATOR'S OWN MACHINE TO START AN AGENT. `goal`, `model`,
        // `thread` and `wait_ms` are all optional; only `channel` is required.
        // The op NEVER names an operator — the server stamps the authenticated
        // caller, because the only machine an agent may ask is its own
        // operator's, and there is no argument here that could say otherwise.
        case "launch_agent": {
            const miss = (0, respond_1.missingParams)("launch_agent", args, ["channel"]);
            if (miss)
                return miss;
            return (0, channel_ops_launch_1.opLaunchAgent)(client, args.channel, {
                thread: args.thread,
                goal: args.goal,
                model: args.model,
                // ⚠ PASSED THROUGH AS A STRING, NEVER PARSED HERE. Whether it is an
                // id or a name — and whether a name is ambiguous — is decided
                // SERVER-SIDE, against the caller's own template visibility, which
                // this process cannot evaluate.
                template: args.template,
                // ⚠ THE ONE THING THAT MAKES THE DOCTRINE'S "do NOT issue it again"
                // TRUE IN CODE (A10/G10). Without a key a re-issue after a timeout files
                // a SECOND directive and starts a SECOND agent on the same work; with
                // one, the server hands back the first request's directive and the
                // result says `retry=existing`.
                clientMsgId: args.client_msg_id,
                waitMs: args.wait_ms,
            });
        }
        // ⚠ END ONE OF THE OPERATOR'S OWN RUNNING AGENTS. The SAME mailbox
        // `launch_agent` writes, with `kind: "end"` — so the machine decides, a
        // refusal is normal and a timeout is PENDING rather than failed. The op
        // NEVER names an operator: the server stamps the authenticated caller,
        // and a target belonging to another member is refused before any row
        // exists. ⚠ `channel` IS REQUIRED even though `agent_id` addresses the
        // target on its own — the create proves a MEMBERSHIP ROW there, which is
        // what stops this being a bare "end agent <id>" primitive.
        case "end_agent": {
            const miss = (0, respond_1.missingParams)("end_agent", args, [
                "channel",
                "agent_id",
            ]);
            if (miss)
                return miss;
            return (0, channel_ops_agent_1.opEndAgent)(client, args.channel, args.agent_id, {
                waitMs: args.wait_ms,
            });
        }
        // ⚠ RELABEL ONE OF THE OPERATOR'S OWN AGENTS — DISPLAY ONLY, on that one
        // machine. `name` is REQUIRED and the EMPTY STRING is a legal value that
        // CLEARS the name, which is why it is checked for presence rather than
        // for truthiness: `missingParams` would reject "" as absent and delete
        // the one gesture that undoes a rename.
        case "rename_agent": {
            const miss = (0, respond_1.missingParams)("rename_agent", args, [
                "channel",
                "agent_id",
            ]);
            if (miss)
                return miss;
            // ⚠ NOT `missingParams`, AND THAT IS THE WHOLE REASON THIS BRANCH IS
            // HAND-WRITTEN. That helper counts the EMPTY STRING as absent, which is
            // right for every other param on this tool and wrong for exactly this
            // one: `name: ""` is the legal, deliberate gesture that CLEARS a
            // display name. Routing it through the helper would delete the only way
            // to undo a rename and report it as a missing argument.
            if (typeof args.name !== "string") {
                return (0, respond_1.err)('op="rename_agent" is missing required param: name. Pass the display name you want (1-60 visible characters on one line), or the EMPTY STRING to clear the name back to "Agent #<id>".');
            }
            return (0, channel_ops_agent_1.opRenameAgent)(client, args.channel, args.agent_id, args.name, { waitMs: args.wait_ms });
        }
        // ⚠ RE-POSTURE ONE OF THE OPERATOR'S OWN RUNNING AGENTS — the SAME mailbox
        // again, `kind: "set_agent_mode"`. ⚠ IT ASKS AND NEVER WIDENS: that machine
        // clamps each axis to the operator's own stored ceiling, so nothing here
        // may narrate a posture as granted. ⚠ UNLIKE THE TWO ABOVE IT **IS** GATED
        // BY THAT MACHINE'S LAUNCH TOGGLE — a posture can cause compute to be spent.
        case "set_agent_mode": {
            const miss = (0, respond_1.missingParams)("set_agent_mode", args, ["channel", "agent_id"]);
            if (miss)
                return miss;
            // ⚠ **NOT `missingParams`, AND THAT IS THE WHOLE REASON THIS CHECK IS
            // HAND-WRITTEN** — the same move `rename_agent`'s `name` check above
            // makes, for the neighbouring reason. That helper answers ONE question
            // per param ("is this one present?") and cannot express "at least one of
            // these two": listing both would demand BOTH and delete the ordinary
            // case (move one axis, leave the other alone), and listing neither would
            // let an empty ask reach a row whose only possible answer is a refusal
            // for a request that was never expressible. ⚠ The route's zod refuses it
            // again and the column CHECK a third time at rest; this is the only one
            // of the three that costs the caller nothing — no row, no claim, no
            // two-minute round trip.
            if (args.tools === undefined && args.messages === undefined) {
                return (0, respond_1.err)('op="set_agent_mode" is missing required params: pass at least one of tools (manual | accept_edits | auto | bypass) or messages (ask | auto_inbound | auto_outbound | auto_both). Passing one and omitting the other is normal — the omitted axis is left alone. ⚠ Whatever you pass is a REQUEST: your operator\'s machine narrows it to the ceiling they set by hand and never widens past it.');
            }
            // ⚠ THE TWO AXES GO THROUGH UNTOUCHED. The schema's enum is the only
            // shape check this process has; the CEILING lives on the operator's
            // machine, so nothing here may predict the outcome.
            return (0, channel_ops_agent_mode_1.opSetAgentMode)(client, args.channel, args.agent_id, { tools: args.tools, messages: args.messages }, { waitMs: args.wait_ms });
        }
    }
}
