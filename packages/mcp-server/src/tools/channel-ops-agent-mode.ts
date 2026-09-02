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
 * echoed back. `channel-ops-launch.ts › postureFacts` is the ONE statement of
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

import type {
  DoplClient,
  LaunchMessageMode,
  LaunchRefusalReason,
  LaunchToolMode,
} from "@dopl/client";
import { ok, type ToolResponse } from "./respond";
import { isErr, resolveChannelOr } from "./channel-shared";
import { bareAgentId } from "./channel-agent-id";
import { fileAndHold, pendingFacts } from "./channel-ops-agent";
// ⚠ SHARED WITH THE LAUNCH OP, NOT COPIED. Both lanes can be clamped and both
// must say "not reported" in the same word; two statements of that distinction
// is how one of them quietly starts echoing the request back as if it were the
// answer.
import { postureFacts } from "./channel-ops-launch";
// ⚠ ONE write-result renderer, shared with every other op on this tool (T10).
import { factsLine } from "./channel-facts";

/**
 * THE REFUSAL CONTRACT FOR **THIS** VERB — a THIRD map over the same nine-word
 * enum, and the third one is not duplication.
 *
 * ⚠ **THE WIRE WORD IS SHARED; WHAT IT MEANS TO DO NEXT IS NOT, AND HERE TWO OF
 * THEM MEAN THE OPPOSITE OF WHAT THEY MEAN NEXT DOOR.**
 *   • `cap` on a LAUNCH means "wait for a slot". On a re-posture it cannot mean
 *     that at all — no slot is being taken, the agent is already running — so
 *     borrowing that sentence would tell a caller to wait for something that has
 *     nothing to do with what failed.
 *   • `no-bridge` on an END is explicitly NOT the launch toggle, and
 *     `channel-ops-agent.ts` says so in as many words. **HERE IT CAN BE**, because
 *     this kind IS gated by it. Sharing that map would ship the false denial.
 *
 * ⚠ EACH SENTENCE ENDS IN WHAT TO DO, because a reason with no next action gets
 * an agent to retry the same call.
 */
const RETRY_ADVICE: Record<LaunchRefusalReason, "once" | "no"> = {
  // ⚠ THE ORDINARY ANSWER, AND NOT A FAULT. A posture belongs to a RUNNING
  // session; an agent that finished has none to move and no re-issue will find
  // one.
  "no-session": "no",
  // ⚠ **THE WORD THIS OP EXISTS TO GET RIGHT.** Here `no-bridge` really can be
  // the launch toggle, unlike on an end or a rename — and a toggle is a decision,
  // so the answer is `no` either way. The doctrine names both causes.
  "no-bridge": "no",
  // ⚠ THE ONE GENUINELY TEMPORARY REFUSAL ON THE WHOLE SURFACE.
  busy: "once",
  "no-sdk": "no",
  "auth-hold": "no",
  // ⚠ THE FOUR BELOW BELONG TO STARTING AN AGENT AND REACH THIS VERB ONLY AS a
  // machine's catch-all: none has a producer here, so arriving IS the anomaly and
  // the answer is `no` — a caller that re-issues over a word nothing could have
  // produced re-issues forever. ⚠ THEY ARE PRESENT BECAUSE THE MAP IS
  // `Record<LaunchRefusalReason, …>` AND THE COMPILER SAYS SO, which is the value
  // of the closed enum: a tenth word could not be minted without every render
  // being made to account for it.
  cap: "no",
  "no-counterparty": "no",
  "no-template": "no",
  "bad-name": "no",
};


/** What was ASKED FOR, rendered for the result. ⚠ `-` for an axis left alone —
 *  which is a legitimate and common request, not an omission. */
function asked(tools?: LaunchToolMode, messages?: LaunchMessageMode): string {
  return `${tools ?? "-"}/${messages ?? "-"}`;
}

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
export async function opSetAgentMode(
  client: DoplClient,
  ref: string,
  agentId: string,
  modes: { tools?: LaunchToolMode; messages?: LaunchMessageMode },
  opts: { waitMs?: number } = {},
): Promise<ToolResponse> {
  // ⚠ RESOLVED FOR THE FENCE, NOT FOR THE PROSE. The channel lookup still has to
  // happen — it is what turns a slug into an id the caller is a member of — but
  // its NAME no longer reaches the result: a fact line names the AGENT and the
  // posture, and the room the caller just addressed by ref is not news to it
  // (T10). Every sibling verb on this tool renders the same way.
  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;
  // ⚠ STRIPPED, NOT VALIDATED — the shared helper `end_agent` and `direct_agent`
  // both use. `read_sessions` prints `@agent-<id>`, so that is what a model
  // copies, and refusing the pasted form would 400 a caller for doing exactly
  // what the neighbouring op taught.
  const agent = bareAgentId(agentId);
  const want = asked(modes.tools, modes.messages);

  const filed = await fileAndHold(
    client,
    ref,
    {
      kind: "set_agent_mode",
      channel: channel.id,
      agentId: agent,
      tools: modes.tools,
      messages: modes.messages,
    },
    opts.waitMs,
  );
  if (filed.done) return filed.response;
  const d = filed.directive;

  // ── THE RESULT: ONE LINE OF FACTS (T10 ∩ T24) ────────────────────────────
  //
  // ⚠ WHAT LEFT, AND WHERE IT WENT. Four paragraphs rode on every answer here —
  // that asked-for is not granted, that a clamp is silent, that nothing else
  // about the agent changed, that a refusal is normal. All four are true of
  // EVERY call on this verb and live once in `channel-doctrine.ts` under YOUR
  // OWN AGENTS. ⚠ WHAT COULD NOT LEAVE is `posture=`/`chain=`: they are the only
  // thing that can tell this caller whether it was narrowed, and `not reported`
  // is a fact about THIS row rather than a rule about the surface.
  //
  // ⚠ `taken`, NOT `set`. The machine says it applied something; it does not say
  // it applied what was asked. `asked=` beside `posture=` is what lets a reader
  // see the gap without a paragraph explaining that one may exist.
  if (d.status === "done") {
    return ok(
      factsLine("taken", {
        agent: `@agent-${agent}`,
        asked: want,
        ...postureFacts(d),
        filed: true,
      }),
    );
  }

  if (d.status === "refused") {
    return ok(
      factsLine("not re-postured", {
        agent: `@agent-${agent}`,
        asked: want,
        reason: d.refusalReason ?? undefined,
        // ⚠ `-` WHEN THE MACHINE NAMED NO REASON, never a guessed verdict.
        retry: d.refusalReason ? RETRY_ADVICE[d.refusalReason] : undefined,
        filed: true,
      }),
    );
  }

  if (d.status === "expired") {
    // ⚠ LAPSED IS NOT REFUSED: no machine ever answered, so nothing is
    // outstanding and the agent keeps the posture it already had.
    return ok(
      factsLine("not re-postured", {
        agent: `@agent-${agent}`,
        asked: want,
        directive: d.id,
        reason: "expired",
        filed: true,
      }),
    );
  }

  return ok(
    factsLine("pending", {
      agent: `@agent-${agent}`,
      asked: want,
      ...pendingFacts(d, "set_agent_mode"),
    }),
  );
}
