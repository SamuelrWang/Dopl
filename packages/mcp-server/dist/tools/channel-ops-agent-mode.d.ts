/**
 * `dopl_channel` op="set_agent_mode" — **ASK THAT A RUNNING AGENT BE GIVEN MORE
 * (OR LESS) ROOM** (2026-09-01, the agent-efficiency wave).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`tool-group-files.ts › toolGroupFiles`) — a handler in an unprefixed file is
 * invisible to the declared-param drift guards.
 *
 * ⚠ **SPLIT FROM `channel-ops-agent.ts` AT THE 500-LINE CAP (INVARIANTS §1), AND
 * THE SEAM IS REAL.** That file's PLUMBING is shared and imported rather than
 * copied — {@link fileAndHold}, {@link pendingLines}, the hold budget, the
 * foreign-target refusal. Its ARGUMENT is not shared at all, which is why the
 * refusal map below is a third one and not a reuse; see the block on it.
 *
 * ── THE ONE THING EVERY LINE IN HERE HAS TO RESPECT ─────────────────────────
 *
 * **IT ASKS FOR A POSTURE. IT NEVER WIDENS ONE.** The operator's machine CLAMPS
 * whatever is named down to the ceiling that operator chose by hand in their own
 * settings (`dopl-desktop-app/main/launch-posture.js › narrowTo`, against
 * `channel-prefs.js › getLaunchPosture`) and never past it. The ticket's "unless
 * the caller is the operator's own account" carve-out was REFUSED and the reason
 * is measurable: every caller on this lane already IS the operator's own account,
 * so the exception is the whole set.
 *
 * ⚠ **A CALLER THAT READS "SET" INSTEAD OF "ASK" WILL REPORT A POSTURE IT DOES
 * NOT HAVE**, and then size its next instruction for room the agent was never
 * given — the failure this op's whole copy budget is spent preventing. There is
 * no operator carve-out to add, no argument that lifts the ceiling, and no wording
 * that makes one appear.
 *
 * ⚠ **AND THE CLAMP IS NOT REPORTED TODAY.** `LaunchDirective.appliedToolMode` and
 * its two siblings are `null` on every live row because no machine writes them
 * yet, and `null` MEANS "NOT REPORTED" — never "unclamped", never the request
 * echoed back. `channel-facts.ts › postureFacts` is the ONE statement of
 * that distinction and this op renders the same two facts from it.
 *
 * ── ⚠ WHERE THIS DIFFERS FROM ITS TWO SIBLINGS, AND IT IS THE OPPOSITE ──────
 *
 * `end_agent` and `rename_agent` ride FREE of the machine's launch-consent
 * toggle: a stop verb and a display label widen nothing, so an abused call costs
 * an agent that stops or a card that reads differently. **This one is gated by
 * it** (`main/launch-directive-wire.js › KINDS_NEEDING_LAUNCH_CONSENT` lists it
 * beside `launch`), because more room can mean more work run on hardware the
 * operator pays for — which is exactly what that toggle exists to gate. So
 * `no-bridge` MAY genuinely mean the toggle is off here, and the sentence below
 * is allowed to say so where the other file's is forbidden to.
 */
import type { DoplClient, LaunchMessageMode, LaunchToolMode } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * ASK THAT ONE OF THE OPERATOR'S OWN RUNNING AGENTS BE RE-POSTURED.
 *
 * ⚠ **PER AGENT, NEVER PER THREAD**, and there is no oldest-agent fallback: under
 * multiplayer a thread carries several agents, so a guess would re-permission one
 * the caller never addressed and report success. The instance id is the whole
 * address, and the create schema refuses anything that is not one.
 *
 * ⚠ **AT LEAST ONE AXIS IS REQUIRED AND THE CHECK IS THE REGISTRAR'S**, not this
 * function's — see `channel.ts`'s branch for why `missingParams` cannot express
 * "at least one of". The route's zod refuses the empty ask a second time, and the
 * column CHECK a third, at rest.
 */
export declare function opSetAgentMode(client: DoplClient, ref: string, agentId: string, modes: {
    tools?: LaunchToolMode;
    messages?: LaunchMessageMode;
}, opts?: {
    waitMs?: number;
}): Promise<ToolResponse>;
