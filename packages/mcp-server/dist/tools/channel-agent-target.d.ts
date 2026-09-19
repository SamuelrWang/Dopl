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
import { type ToolResponse } from "./respond";
/**
 * The bare instance id this call is about, or the refusal to return instead.
 *
 * ⚠ **IT ANSWERS A UNION RATHER THAN THROWING** — `channel-ops-launch-name.ts › launchName`'s
 * shape, so every refusal on the agent lanes narrows the same way.
 * ⚠ **ONE HELPER FOR ALL FOUR MANAGE VERBS** (`end`, `rename`, `posture`, `direct`). They share
 * `bareAgentId` already; sharing only the STRIP and not the CHECK is how three of them would
 * end up with the bare 400 the fourth one fixed.
 */
export declare function agentTarget(raw: string): {
    agent: string;
} | ToolResponse;
/** TRUE for {@link agentTarget}'s refusal arm. ⚠ A PREDICATE RATHER THAN A CAST, so the
 *  caller's narrowing is the compiler's rather than a reader's. */
export declare function isAgentTargetRefusal(answer: {
    agent: string;
} | ToolResponse): answer is ToolResponse;
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
export declare function foreignAgent(agentId: string, verb: string): ToolResponse;
