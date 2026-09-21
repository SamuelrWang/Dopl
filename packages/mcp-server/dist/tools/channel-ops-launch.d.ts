/**
 * `dopl_channel` op="manage" action="launch" — ASK THE OPERATOR'S OWN DESKTOP TO START AN
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
import type { AgentColorKey, DoplClient, LaunchMessageMode, LaunchToolMode } from "@dopl/client";
import { type ToolResponse } from "./respond";
/** The line a PENDING (or expired) directive ends on. ⚠ Says the id, because the
 *  id is the only handle the agent has left, and says NOT to re-issue. */
/**
 * ASK FOR AN AGENT, then hold briefly for the answer.
 *
 * ⚠ FOUR TERMINAL SHAPES, and each one ends in a different next action:
 * OFFLINE (nothing filed), LAUNCHED (an id to address), REFUSED (one of seven
 * sentences), PENDING/EXPIRED (the id, and an instruction not to re-issue).
 */
export declare function opLaunchAgent(client: DoplClient, ref: string, opts?: {
    thread?: string;
    goal?: string;
    model?: string;
    /**
     * **WHICH RUNTIME — ASKED FOR, AND REFUSED RATHER THAN SUBSTITUTED** (2026-09-21, U9).
     *
     * ⚠ **A SEPARATE FIELD FROM `model` ABOVE, ALWAYS.** `runtime` picks the ADAPTER, `model`
     * picks a model inside it; neither is ever derived from the other. A live launch carrying
     * `model: "codex"` was accepted and started Claude Sonnet, which is the defect this closes.
     * ⚠ PASSED THROUGH UNTOUCHED, like `template` and `color`: the roster is the operator's own
     * desktop registry and this process cannot see it. Omitted means the documented chain (the
     * channel's runtime, then that machine's default) — never a particular vendor.
     */
    runtime?: string;
    /** Template id OR exact name. ⚠ Passed through untouched — the id/name
     *  disambiguation and the visibility check both happen server-side. */
    template?: string;
    /** ⚠ **ASKED FOR, NEVER SET.** The operator's machine clamps each axis to
     *  that operator's own stored ceiling; omitting both is the pre-T24
     *  behaviour. Passed through untouched — this process cannot see the
     *  ceiling and must not pretend to. */
    tools?: LaunchToolMode;
    messages?: LaunchMessageMode;
    /** ⚠ REFUSED rather than clamped when the channel forbids it, which is why
     *  it is a separate field and not a third axis. Omitted is NOT `false`. */
    chain?: boolean;
    /** ⚠ **THE IDEMPOTENCY KEY, AND IT IS WHAT MAKES A TIMED-OUT LAUNCH SAFE TO
     *  RETRY** (2026-09-02, A10/G10). Passed through untouched: the server
     *  probes it against `(channel, this operator)` and returns the stored
     *  directive rather than filing a second one. */
    clientMsgId?: string;
    /** ⚠ **ASKED FOR, AND REFUSED RATHER THAN SUBSTITUTED WHEN TAKEN.** Passed through
     *  untouched — the taken set spans every member's live agents and only the server
     *  can see it. Omitted means "first free", never "no colour". */
    color?: AgentColorKey;
    /** **WHAT TO CALL THE NEW AGENT — REQUIRED** (Samuel, 2026-09-15: *"if agents are spinning
     *  up agents, they should be the ones that are naming the agent … certainly shouldn't be an
     *  agent with the id as the name."*). ⚠ OPTIONAL IN THE TYPE AND REFUSED AT RUNTIME: the
     *  argument arrives off an MCP wire as unvalidated JSON, so the type says what may ARRIVE and
     *  the refusal below is what the caller is TOLD — and only that layer can say what to pass. */
    name?: string;
    waitMs?: number;
}): Promise<ToolResponse>;
