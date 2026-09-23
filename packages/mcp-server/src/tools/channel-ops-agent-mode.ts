/**
 * `dopl_channel` op="manage" action="posture" — **ASK THAT A RUNNING AGENT BE GIVEN MORE
 * (OR LESS) ROOM** (2026-09-01, the agent-efficiency wave).
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`tool-group-files.ts › toolGroupFiles`) — a handler in an unprefixed file is
 * invisible to the declared-param drift guards.
 *
 * ⚠ **SPLIT FROM `channel-ops-agent.ts` AT THE 500-LINE CAP (INVARIANTS §1), AND
 * THE SEAM IS REAL.** That file's PLUMBING is shared and imported rather than
 * copied — {@link fileAndHold}, {@link pendingFacts}, the hold budget and the
 * retry map (`channel-directive-hold.ts`), the foreign-target refusal. Its
 * ARGUMENT is not shared: the sentences and the consent story are this verb's own.
 *
 * ── THE ONE THING EVERY LINE IN HERE HAS TO RESPECT ─────────────────────────
 *
 * **IT ASKS FOR A POSTURE, IN THE AGENT'S OWN RUNTIME'S WORDS. IT NEVER WIDENS ONE.**
 * The operator's machine CLAMPS whatever is named down to the ceiling that operator
 * chose by hand for that runtime (`dopl-desktop-app/main/directive-agent-ops.js ›
 * setAgentMode`), never past it, and a narrower ask sticks for that agent. The ticket's "unless
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
 * ⚠ **THE CLAMP IS REPORTED ON THE `done`** (`appliedToolMode` / `appliedMessageMode`,
 * F2), and `null` MEANS "NOT REPORTED" (an older desktop) — never "unclamped", never
 * the request echoed back. `channel-facts.ts › postureFacts` is the ONE statement of
 * that distinction and this op renders the same facts from it.
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
  LaunchToolMode,
} from "@dopl/client";
import { LAUNCH_RETRY_ADVICE } from "./channel-directive-hold";
import { ok, type ToolResponse } from "./respond";
import { isErr, resolveChannelOr } from "./channel-shared";
// ⚠ THE SHARED TARGET CHECK (`channel-agent-target.ts`, S51, 2026-09-18) — the strip every
// manage verb already did, plus the check three of them were missing.
import { agentTarget, isAgentTargetRefusal } from "./channel-agent-target";
import { fileAndHold, pendingFacts } from "./channel-ops-agent";
// ⚠ SHARED WITH THE LAUNCH OP, NOT COPIED. Both lanes can be clamped and both
// must say "not reported" in the same word; two statements of that distinction
// is how one of them quietly starts echoing the request back as if it were the
// answer.
import { postureFacts } from "./channel-facts";
// ⚠ ONE write-result renderer, shared with every other op on this tool (T10).
import { factsLine } from "./channel-facts";

// ⚠ `no-bridge` HERE CAN BE THE LAUNCH TOGGLE, because this kind IS gated by it (unlike `end` /
// `rename`) — or a tool word the agent's runtime does not speak. `LAUNCH_RETRY_ADVICE` answers
// `no` either way; the doctrine names both causes.

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
  // ⚠ **STRIPPED AND NOW VALIDATED** — the shared helper `end`, `rename` and `direct` also
  // use (S51). `read_sessions` prints `@agent-<id>`, so the pasted form stays accepted; a NAME
  // handle is refused BY NAME here instead of dying at the create schema as a bare
  // `VALIDATION_FAILED`. ⚠ AHEAD OF THE CHANNEL LOOKUP: a refusal needing no round trip
  // must not cost one.
  const target = agentTarget(agentId);
  if (isAgentTargetRefusal(target)) return target;
  const agent = target.agent;

  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;
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
        retry: d.refusalReason ? LAUNCH_RETRY_ADVICE[d.refusalReason] : undefined,
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
