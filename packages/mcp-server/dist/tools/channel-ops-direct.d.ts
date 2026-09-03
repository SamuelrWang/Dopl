/**
 * `dopl_channel` op="manage" action="direct" / op="status" — THE PRIVATE DIRECT
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
 *      the latter wants `op="status"`.
 *
 * ⚠ A DIRECTION IS NOT A MESSAGE (INVARIANTS §5) — no `seq`, so it can never end
 * an `await`. That is why this op holds on the ROW, exactly as `launch_agent` does.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * DIRECT ONE AGENT, then hold briefly for its answer.
 *
 * ⚠ FIVE TERMINAL SHAPES, each ending in a different next action: OFFLINE
 * (nothing filed), DELIVERED WITH A REPLY, DELIVERED WITH NONE REPORTED, REFUSED
 * (one of five sentences), PENDING/EXPIRED (the id, and do not re-issue).
 */
export declare function opDirectAgent(client: DoplClient, ref: string, agentId: string, body: string, opts?: {
    thread?: string;
    /** ⚠ **THE IDEMPOTENCY KEY, AND IT IS WHAT MAKES A TIMED-OUT DIRECTION SAFE
     *  TO RETRY** (2026-09-02, A10/G10). Passed through untouched: the server
     *  probes it against `(channel, this operator)` and returns the stored
     *  direction — `reply` included, if the machine has answered by now — rather
     *  than saying the same thing to a live agent twice. */
    clientMsgId?: string;
    waitMs?: number;
}): Promise<ToolResponse>;
/**
 * WHAT I HAVE ASKED MY OWN AGENTS, AND WHAT CAME BACK.
 *
 * ⚠ **IT EXISTS BECAUSE A DIRECTION HAS NO SECOND SURFACE.** `launch_agent`'s
 * answer to "what happened to my pending row" is *find the agent in
 * `read_sessions`*; a direction has no such fallback — the REPLY is the value, and
 * without this op a timed-out hold would strand it forever.
 * ⚠ **A SIBLING OP, NOT A MODE ON `direct_agent`.** Collapsing a read into a write
 * would put two authorization stories behind one signature, which is the argument
 * `channel-ops-hold-workspace.ts` was split out on.
 * ⚠ OWN-SCOPED AT THE SERVER — the transport credential IS the caller, so no
 * identity is passed and there is no argument that could name another operator.
 */
export declare function opReadDirections(client: DoplClient, opts?: {
    channel?: string;
    agent?: string;
}): Promise<ToolResponse>;
