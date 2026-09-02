import "server-only";
import { resolveAgentModelId } from "../lib/agent-models";
import { chainRefused, clampPosture, resolveChain } from "../lib/agent-posture";
import type { LaunchMessageMode, LaunchToolMode } from "../types";
import { mapAgentPosture, type ChannelRow } from "./dto";
import { ChannelAgentChainForbiddenError } from "./errors";

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
 * ⚠ **CHAIN IS CHECKED BEFORE THE CLAMP**, so a refusal is never reported as a
 * narrowing — and it REFUSES where the two mode axes CLAMP. That asymmetry is the
 * desktop's own: a clamped posture still produces a working agent under more
 * supervision, while a clamped chain produces one that hits a bound it was told it
 * did not have, mid-run, after the caller handed it work assuming workers.
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
  const ceiling = mapAgentPosture(channel);
  if (chainRefused(input.chain, ceiling)) throw new ChannelAgentChainForbiddenError();
  const { tools, messages } = clampPosture(input, ceiling);
  return {
    tools,
    messages,
    chain: resolveChain(input.chain, ceiling),
    model: resolveAgentModelId(input.model),
  };
}
