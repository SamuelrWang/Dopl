/**
 * `dopl_channel` op="launch_agent" — ASK THE OPERATOR'S OWN DESKTOP TO START AN
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
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
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
    /** Template id OR exact name. ⚠ Passed through untouched — the id/name
     *  disambiguation and the visibility check both happen server-side. */
    template?: string;
    waitMs?: number;
}): Promise<ToolResponse>;
