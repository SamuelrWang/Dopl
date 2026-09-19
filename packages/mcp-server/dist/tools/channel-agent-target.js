"use strict";
/**
 * **WHICH AGENT DOES `to` NAME ON THE MANAGE LANE — AND THE TWO REFUSALS WHEN THE ANSWER IS
 * "none of yours"** (S51, 2026-09-18).
 *
 * ⚠ **THE HANDLE PROMISE IS TRUE ON `op="send"` AND THE MANAGE LANE CANNOT KEEP IT.** `to`'s
 * describe used to offer *"an agent (`@agent-<id>` or its handle)"* flatly, and on a send that
 * is honest: the server's union resolver
 * (`channels/server/service-writes-metadata-recipient.ts › resolveToRecipients`) turns a name
 * handle into a recipient. **Nothing on the manage lane does.** `bareAgentId` strips `@` and
 * `agent-` without validating, so `to="@my-agent"` reached
 * `schema-launch.ts › AgentDirectiveCreateSchema.agentId` — anchored at eight characters —
 * and died as a bare `VALIDATION_FAILED: Request body failed validation`, which names no field.
 *
 * ⚠ **AND THERE IS NO LOCAL RESOLUTION TO FALL BACK ON.** No client method maps a name to an
 * instance id, and `channel_sessions.name` IS the id on every current desktop
 * (`channel-session-handle.ts` documents that at length) — so a resolver here would be
 * inventing a lookup rather than restating one. **The refuse branch is the only honest branch**,
 * and the sentence says where the id comes from instead.
 *
 * ⚠ **THE PASTED FORMS STAY ACCEPTED, EXACTLY AS BEFORE.** `@agent-<id>`, `agent-<id>` and the
 * bare id all pass: `read_sessions` and `op="status"` print the handle, so that is what a model
 * copies, and 400-ing a caller for doing what the neighbouring op taught is the invisible
 * failure this surface refuses everywhere else. What is refused is a value that is not an id
 * AT ALL after the strip.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan (`parity.test.ts`) and the
 * removed-vocabulary source scan (`channel-law.test.ts`, `law-scan.test.ts`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentTarget = agentTarget;
exports.isAgentTargetRefusal = isAgentTargetRefusal;
exports.foreignAgent = foreignAgent;
const channel_agent_id_1 = require("./channel-agent-id");
const respond_1 = require("./respond");
/**
 * The bare instance id this call is about, or the refusal to return instead.
 *
 * ⚠ **IT ANSWERS A UNION RATHER THAN THROWING** — `channel-ops-launch-name.ts › launchName`'s
 * shape, so every refusal on the agent lanes narrows the same way.
 * ⚠ **ONE HELPER FOR ALL FOUR MANAGE VERBS** (`end`, `rename`, `posture`, `direct`). They share
 * `bareAgentId` already; sharing only the STRIP and not the CHECK is how three of them would
 * end up with the bare 400 the fourth one fixed.
 */
function agentTarget(raw) {
    const agent = (0, channel_agent_id_1.bareAgentId)(raw);
    if ((0, channel_agent_id_1.isAgentId)(agent))
        return { agent };
    return (0, respond_1.err)([
        // ⚠ THE TOKEN LINE NAMES THE FIELD, THE VERDICT AND WHERE THE ID COMES FROM — the same
        // grammar the launch caps use (`channel-ops-launch-goal.ts`). `retry=` is an OP rather
        // than `no`, because unlike a too-long field this one has a next call that fixes it.
        `Nothing was filed — field=to reason=not_an_agent_id retry=dopl_channel(op="status")`,
        `\`to\` must be an agent INSTANCE id on op="manage" — \`@agent-<id>\`, or the bare eight characters. A NAME handle (\`@my-agent\`) is a real address when you SEND, but never here: nothing on this lane resolves a name to an instance, so no request was made and nothing is pending.`,
        `dopl_channel(op="status") lists your running agents with the id to pass.`,
    ].join("\n"));
}
/** TRUE for {@link agentTarget}'s refusal arm. ⚠ A PREDICATE RATHER THAN A CAST, so the
 *  caller's narrowing is the compiler's rather than a reader's. */
function isAgentTargetRefusal(answer) {
    return !("agent" in answer);
}
/**
 * ⚠ **THE FOREIGN-AGENT REFUSAL IS THE ONE THE MANAGE SURFACE ANSWERS ITSELF**, before any row
 * exists — a 403 `CHANNEL_AGENT_FOREIGN` out of the create. Every other outcome comes back from
 * a machine.
 *
 * ⚠ **IT LIVES BESIDE {@link agentTarget} BECAUSE THEY ARE THE SAME QUESTION ASKED TWICE**
 * (moved out of `channel-ops-agent.ts` on 2026-09-18, which was at the §1 cap): is the value in
 * `to` an agent this caller can manage? One arm answers "that is not an id", the other "that id
 * is not yours". Splitting them across files is how the second one's careful argument stops
 * being read by whoever edits the first.
 *
 * ⚠ IT NAMES THE FACT PLAINLY RATHER THAN 404-ING, and the server's error docblock argues why
 * that discloses nothing: the caller already proved membership of the channel, inside which
 * `op="rooms" action="members"` and `op="status"` are readable anyway. A 404 here would tell an
 * orchestrator its OWN agent had vanished and send it to re-launch — the expensive wrong answer.
 *
 * ⚠ IT STAYS PROSE WHERE THE SUCCESS PATHS BECAME FACT LINES (T10, 2026-09-02), and the
 * distinction is the tier's own: a REFUSAL is not narration under a write that happened, it is
 * the answer to a call that was never made. It also has to close a door — "do not look for
 * another route" — which is an instruction, not a fact about a row.
 */
function foreignAgent(agentId, verb) {
    return (0, respond_1.err)([
        `Nothing was ${verb} — agent \`${agentId}\` is ANOTHER MEMBER'S, and **no request was filed**.`,
        `You can only manage agents running on YOUR OWN operator's machine. A peer's agent appears in a channel as a handle and is not reachable from here at all — there is no permission that would change that, so do not look for another route and do not ask anyone to grant one.`,
        `dopl_channel(op="status") lists exactly the agents you CAN manage. If you meant one of yours, take the id from there.`,
    ].join("\n"));
}
