/**
 * `dopl_channel` op="end_agent" / op="rename_agent" — **MANAGE THE OPERATOR'S OWN
 * RUNNING AGENTS** (2026-09-01, Samuel: *"I need you to build out dopl mcp being
 * able to end agents. Dopl MCP need to be able to do all that stuff"*).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) — a handler in an unprefixed file is invisible to the declared-
 * param drift guards.
 *
 * ── THE ONE THING EVERY LINE IN HERE HAS TO RESPECT ─────────────────────────
 *
 * **THESE OPS ASK. THEY DO NOT DO ANYTHING THEMSELVES.** Agents live in a desktop
 * main process no server can reach; what crosses the wire is a row in the SAME
 * mailbox `op="launch_agent"` writes, which the operator's machine polls, claims
 * and answers. `channel-ops-launch.ts` states the three consequences at length
 * and all three hold here — a refusal is a normal outcome, a timeout is not a
 * failure, and "ended" means A MACHINE SAID SO.
 *
 * ── ⚠ WHERE THESE TWO DIFFER FROM `launch_agent`, AND IT IS WORTH SAYING ────
 *
 *  1. **NO CONSENT TOGGLE APPLIES.** `launch_agent`'s `no-bridge` is the operator
 *     saying no via a per-machine setting. That setting gates LAUNCHES ONLY. An
 *     end or a rename is not refused by it and **the copy below must never tell a
 *     caller to ask for it to be turned on** — that would send an orchestrator to
 *     request a permission that has nothing to do with what failed.
 *  2. **THE COMMONEST REFUSAL IS NOT AN ERROR.** `no-session` means that agent is
 *     not running any more, and an agent that finished is the ordinary cause. For
 *     an END that is the outcome the caller wanted, reached by another route, and
 *     the sentence says so rather than reading as a fault.
 *  3. **THERE IS NOTHING TO POLL AFTERWARDS EXCEPT `read_sessions`**, which is
 *     also where the caller got the id — so every terminal sentence points back
 *     at it.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * END ONE OF THE OPERATOR'S OWN RUNNING AGENTS.
 *
 * ⚠ **A STOP VERB. IT TOUCHES NO THREAD AND DELETES NO MESSAGE** — everything the
 * agent posted stays in the channel, attributed exactly as before. The sentence
 * says so, because "end" is the word an orchestrator is most likely to over-read
 * as "remove".
 * ⚠ **YOU CANNOT END YOURSELF FROM HERE AND THE QUESTION DOES NOT ARISE**: the
 * caller of this op is an EXTERNAL session, which is not a desktop agent and has
 * no instance id. The in-process twin refuses self-end because the dispatch would
 * abort the calling turn; nothing on this lane can be in that position.
 */
export declare function opEndAgent(client: DoplClient, ref: string, agentId: string, opts?: {
    waitMs?: number;
}): Promise<ToolResponse>;
/**
 * RENAME ONE OF THE OPERATOR'S OWN AGENTS.
 *
 * ⚠ **DISPLAY ONLY, ON ONE MACHINE, AND EVERY SENTENCE HERE HAS TO CARRY THAT.**
 * The name lives in `main/agent-names.js`'s local store; nothing resolves an agent
 * by it, no server holds it, and `read_sessions` will never show it. A caller that
 * believed otherwise would start addressing `@research` and reach nobody — the
 * exact failure `channel-session-handle.ts` documents at length for the same
 * reason.
 * ⚠ AN EMPTY `name` CLEARS, back to `Agent #<id>`. One verb, not two.
 */
export declare function opRenameAgent(client: DoplClient, ref: string, agentId: string, name: string, opts?: {
    waitMs?: number;
}): Promise<ToolResponse>;
