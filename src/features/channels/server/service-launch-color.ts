import "server-only";
import {
  agentColorOrNull,
  firstFreeAgentColor,
  freeAgentColors,
} from "../lib/agent-colors";
import { AgentColorTakenError } from "./errors";
import {
  foreignLiveColorsByChannel,
  pendingDirectiveColors,
} from "./repository-session-colors";
import type { AgentColorKey } from "../types";
import type { ChannelContext } from "./service-shared";

/**
 * **THE LAUNCH LANE'S COLOUR GATE** — one rule, its own module (2026-09-13;
 * docs/specs/agent-colors.md).
 *
 * ⚠ **ITS OWN FILE ON THE `service-launch-posture.ts` / `service-launch-template.ts`
 * PRECEDENT** (§1's cap forced the extraction at 562 lines, and the seam is the one
 * those two already drew): `service-launch.ts` owns the ORDER of the create's gates
 * and what each refusal is shaped like; this owns what "that colour is taken" MEANS
 * and moves when the bank moves.
 */

/**
 * **WHICH COLOUR THE DIRECTIVE RECORDS** — the create's SIXTH gate.
 *
 * ⚠ **IT SITS WHERE THE POSTURE CEILING SITS AND FOR THE IDENTICAL REASON: ABOVE
 * PRESENCE, BELOW THE IDEMPOTENCY PROBE.** `offline` is a 200 meaning "nothing was
 * asked", so answering a taken colour with "your machine is asleep" sends the caller
 * to fix the wrong thing and get the real refusal a minute later — and a colour
 * collision needs nobody's machine to be up. Below the probe because a STORED row is
 * this request's answer and must never be re-decided against a world that has moved.
 *
 * ⚠ **THE TAKEN SET COUNTS EVERY MEMBER, INCLUDING THE CALLER.** `exceptUserId` is
 * `null` here, unlike the push lane: this is a NEW agent, so the caller's own live
 * agents are genuine competitors for the key. Passing the caller's id would let one
 * operator run two identical colours in one room, which is the rule inverted.
 *
 * ⚠ **REFUSING RATHER THAN SUBSTITUTING IS THE WHOLE DIFFERENCE BETWEEN THE TWO
 * LANES.** Here the caller named a key moments ago and is waiting on the answer, so
 * the honest reply is "not that one, here is what is left". On the push lane the pick
 * is minutes old, the alternative to substituting is discarding a machine's entire
 * projection, and nobody is waiting — `server/session-colors.ts` states both.
 */
export async function resolveDirectiveColor(
  ctx: ChannelContext,
  channelId: string,
  wanted: AgentColorKey | undefined,
  /** ⚠ A PARAMETER WITH A DEFAULT so a test can state an age instead of arranging for one —
   *  `recency-wells.tsx › wellFor`'s own shape, and the reason the expiry cut is testable
   *  without a clock. The create passes nothing. */
  now: number = Date.now()
): Promise<AgentColorKey | null> {
  const [byChannel, directives] = await Promise.all([
    foreignLiveColorsByChannel(ctx.workspaceId, [channelId], null),
    // ⚠ **THE SECOND HALF OF THE TAKEN SET, ADDED 2026-09-14** — see
    // `repository-session-colors.ts › pendingDirectiveColors` for the gap it closes. Issued
    // TOGETHER rather than in sequence: they are independent reads on the create's critical
    // path, and a caller is waiting on the answer.
    pendingDirectiveColors(ctx.workspaceId, channelId),
  ]);
  /**
   * **LIVE SESSIONS ∪ SPOKEN-FOR LAUNCHES**, in that order of certainty.
   *
   * ⚠ **THE EXPIRY CUT IS HERE BECAUSE EXPIRY IS LAZY AND LIVES AT THE SERVICE** (the rule
   * `service-launch.ts › listPendingLaunchDirectives`'s docblock states, and which
   * `toDirective` applies on the read lane). A directive nobody claimed before its TTL ran
   * out has released its key, and holding it anyway would let one abandoned launch narrow
   * the bank for two minutes.
   * ⚠ **AN UNPARSEABLE STAMP COUNTS AS LIVE** — the direction every read of a stamp on this
   * lane fails in: offering a key that is about to come back 409 is the cheap failure, and
   * handing two agents one colour is the expensive one (`agent-color-circles.tsx ›
   * agentColorsTaken` states the same preference for its own unknowns).
   */
  const taken = new Set<string>(byChannel.get(channelId) ?? []);
  for (const row of directives) {
    const at = Date.parse(row.expires_at);
    if (Number.isFinite(at) && at <= now) continue;
    const key = agentColorOrNull(row.color);
    if (key) taken.add(key);
  }
  if (!wanted) return firstFreeAgentColor(taken);
  if (taken.has(wanted)) {
    throw new AgentColorTakenError(wanted, freeAgentColors(taken));
  }
  return wanted;
}
