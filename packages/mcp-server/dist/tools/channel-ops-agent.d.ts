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
import type { DoplClient, LaunchDirective, LaunchMessageMode, LaunchToolMode } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * THE THREE AGENT-MANAGEMENT KINDS AND WHAT EACH CARRIES — **one declaration,
 * shared with `channel-ops-agent-mode.ts`.**
 *
 * ⚠ IT MIRRORS `@dopl/client › AgentDirectiveCreateInput` rather than being it:
 * this is the shape {@link fileAndHold} takes, and stating it once is what lets
 * the third verb live in its own module without a second copy of the union
 * drifting from this one.
 * ⚠ **BOTH AXES ON THE `set_agent_mode` ARM ARE OPTIONAL HERE, DELIBERATELY.**
 * "At least one of them" is a REGISTRAR check (`channel.ts`) and a route check; a
 * type expressing it would be a union of three shapes for one verb, and the
 * caller-facing message would become a parse error instead of a sentence.
 */
export type AgentDirectiveKind = "end" | "rename" | "set_agent_mode";
export type AgentDirectiveInput = {
    kind: "end";
    channel: string;
    agentId: string;
} | {
    kind: "rename";
    channel: string;
    agentId: string;
    name: string;
} | {
    kind: "set_agent_mode";
    channel: string;
    agentId: string;
    tools?: LaunchToolMode;
    messages?: LaunchMessageMode;
};
/**
 * THE PAST-TENSE WORD FOR EACH KIND, IN ONE PLACE.
 *
 * ⚠ A MAP RATHER THAN A TERNARY, and it stopped being cosmetic at the third
 * verb: `kind === "end" ? "ended" : "renamed"` is CORRECT for two kinds and
 * silently reports a RE-POSTURE as a RENAME for three. A conditional over a
 * closed set is the shape that goes wrong the day the set grows, failing nothing
 * on the way.
 */
export declare const VERB_PAST: Record<AgentDirectiveKind, string>;
/** The line a PENDING (or expired) agent directive ends on. ⚠ Says the id,
 *  because the id is the only handle the caller has left, and says NOT to
 *  re-issue.
 *  ⚠ Exported for the same one caller and the same reason as
 *  {@link fileAndHold} — the pending-vs-failed rule must have ONE statement.
 *  ⚠ IT TAKES THE **KIND**, NOT A DISPLAY WORD: the sentence it picks is a claim
 *  about what a later read can prove, and keying that off prose is how a third
 *  verb inherits the second one's answer. */
export declare function pendingLines(d: LaunchDirective, kind: AgentDirectiveKind): string[];
/**
 * FILE THE DIRECTIVE AND HOLD — the half `end_agent` and `rename_agent` share.
 *
 * ⚠ THE CREATE'S TWO NON-MACHINE FAILURES ARE SORTED ON THE **CODE**, NOT THE
 * STATUS, the discipline `channel-ops-launch.ts` adopted when one call gained two
 * ways to 404. Here a 403 is unambiguous, but the 404 is not: it may be the
 * CHANNEL (unknown, or one the caller never joined) and nothing else, so it
 * renders as a channel error rather than as anything about the agent.
 */
/**
 * ⚠ EXPORTED FOR `channel-ops-agent-mode.ts` (2026-09-01), and for that ONE
 * caller. It is the whole hold protocol — file the row, poll it, give up — and a
 * second copy would be a second answer to "how long do we wait", which is the
 * drift the shared `WAIT_*` constants above exist to prevent. ⚠ What is shared
 * is the PLUMBING; every sentence a caller reads is written in its own module,
 * because the three verbs' consent stories differ.
 */
export declare function fileAndHold(client: DoplClient, ref: string, input: AgentDirectiveInput, waitMs: number | undefined): Promise<{
    done: true;
    response: ToolResponse;
} | {
    done: false;
    directive: LaunchDirective;
} | {
    done: true;
    offline: true;
    response: ToolResponse;
}>;
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
