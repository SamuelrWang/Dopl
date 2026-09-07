import "server-only";
import { resolveAgentModelId } from "../lib/agent-models";
// ⚠ 2026-09-06 (items 12, 13, 14): `chainRefused` / `clampPosture` / `resolveChain` and
// `mapAgentPosture` are no longer imported, and `ChannelAgentChainForbiddenError` is no longer
// thrown from anywhere. See the note over `resolveDirectivePosture` — including why the three
// `lib/agent-posture.ts` helpers are left in place rather than deleted from inside this ticket.
import type { LaunchMessageMode, LaunchToolMode } from "../types";
import { type ChannelRow } from "./dto";

/**
 * **THE CREATE'S FIFTH GATE: WHAT THE SERVER PERMITS A LAUNCH TO ASK FOR**
 * (2026-09-02, A9 — guardrails G6, G7, G8).
 *
 * ⚠ **ITS OWN MODULE ON `service-launch-template.ts`'S PRECEDENT** (§1 cap, and
 * the same shape of reason): it is a gate with a rule of its own, and the rule is
 * a SECOND COPY of the desktop's clamp across a tree boundary neither side can
 * import over. `lib/agent-posture.ts` holds the copy and
 * `lib/agent-posture-parity.test.ts` drives both implementations over every pair;
 * this file is only where the gate is SPENT.
 *
 * ⚠ **WHAT G6/G7/G8 ACTUALLY RECORDED IS AN ABSENCE.** The ceiling was an
 * `electron-store` record no server could read (`main/channel-prefs.js ›
 * getLaunchPosture`, `channelAgentChain`), so a directive's requested posture
 * "decided nothing" server-side and an offline or older desktop narrowed nothing
 * and refused nothing.
 *
 * ⚠ **AND `null` ON AN AXIS CLAMPS AND REFUSES NOTHING.** A channel that has never
 * had a ceiling written behaves exactly as it did before this wave, and the
 * desktop's own clamp stays the belt on every path either way.
 */
export interface DirectivePosture {
  tools: LaunchToolMode | null;
  messages: LaunchMessageMode | null;
  chain: boolean | null;
  /** ⚠ AN ECHO, NEVER A GATE (G8). `null` is "this server does not recognise it",
   *  not "refused": the raw `model` still reaches the machine, and a newer desktop
   *  may run a model this build predates. What changes is that the caller is TOLD,
   *  which is the whole of G8's complaint. */
  model: string | null;
}

/**
 * ── ⚠ **THE CLAMP AND THE CHAIN REFUSAL ARE DELETED (2026-09-06, Samuel's rulings on items
 * 12, 13 and 14 — *"make sure all the logic is deleted"*).** ──────────────────────────────
 *
 * WHAT THIS FUNCTION USED TO DO, because the absence should not have to be reconstructed:
 * it read the channel's three ceiling columns and (1) THREW `ChannelAgentChainForbiddenError`
 * when a directive asked for `chain: true` in a room whose manager had forbidden it, and
 * (2) CLAMPED the requested tool and message modes down to the room's recorded maxima.
 *
 * ⚠ **CHAIN WAS CHECKED BEFORE THE CLAMP, AND IT REFUSED WHERE THE MODES NARROWED.** That
 * asymmetry was the desktop's own and is worth preserving in the record: a clamped posture
 * still produces a working agent under more supervision, while a clamped chain produces one
 * that hits a bound it was told it did not have, mid-run, after its caller handed it work
 * assuming workers. Both behaviours are gone; a directive now gets exactly the posture it
 * asked for.
 *
 * ⚠ **THE PARITY PAIR IS BROKEN ON PURPOSE AND SOMEBODY MUST FINISH IT.** `lib/agent-posture.ts`
 * held the SECOND COPY of the desktop's clamp — `clampPosture`, `chainRefused`, `resolveChain`
 * — and `lib/agent-posture-parity.test.ts` drove both implementations over every pair, because
 * neither tree can import the other. With this call site gone those three functions have no
 * server reader. They are NOT deleted here: the desktop half still exists, and removing one
 * side of a pinned pair from inside the other side's ticket is how a parity test becomes a
 * tautology. Flagged in the report rather than done quietly.
 *
 * ⚠ **WHAT SURVIVES IS G8 — THE MODEL ECHO — AND IT IS NOT A GATE.** It never clamped
 * anything; it tells the caller which model this server recognised while the raw value still
 * reaches the machine. None of the three rulings touched it.
 */
export function resolveDirectivePosture(
  channel: ChannelRow,
  input: {
    tools?: LaunchToolMode;
    messages?: LaunchMessageMode;
    chain?: boolean;
    model?: string;
  }
): DirectivePosture {
  // ⚠ `channel` IS NOW UNREAD, AND THE PARAMETER STAYS. Every caller has the row in hand and
  // the signature is the create's fifth gate; dropping it would churn call sites for a
  // function that may well need the row again. Named with a leading underscore would be the
  // alternative, and this file's own convention is to keep the name and say why.
  void channel;
  return {
    // ⚠ THE REQUEST, UNNARROWED. `null` here means "this server records no opinion", which is
    // now the only answer it can give — and it is exactly what a channel with no ceiling
    // written has always produced, so the shape on the wire is unchanged.
    tools: input.tools ?? null,
    messages: input.messages ?? null,
    chain: input.chain ?? null,
    model: resolveAgentModelId(input.model),
  };
}
