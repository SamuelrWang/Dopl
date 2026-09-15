import "server-only";
import * as collab from "./repository-collab";
import { PRESENCE_ONLINE_WINDOW_MS } from "../constants";
import type { ChannelContext } from "./service-shared";

/**
 * **IS THE OPERATOR'S MACHINE EVEN THERE** — the launch lane's one presence question
 * (§1 split out of `service-launch.ts` on 2026-09-15, at the 500-line cap).
 *
 * ⚠ **IT HAD TWO READERS BEFORE IT HAD A FILE.** `service-launch.ts › createLaunchDirective` and
 * `service-launch-agent.ts` both ask it, which is why it was exported in the first place — and a
 * second copy would let one lane call a machine online while the other filed nothing for it.
 * ⚠ `service-launch.ts` RE-EXPORTS IT, so it stays the import path of record and no caller moved.
 */

/**
 * IS THE OPERATOR'S MACHINE EVEN THERE?
 *
 * ⚠ **A HINT, AND THE RESULT MUST SAY SO.** `agent_presence` is per-(user,
 * workspace), not per-machine and not per-channel: it says some listener of this
 * operator's heartbeat recently, not that the machine which would run this agent
 * is up, not that the desktop's launch toggle is on, and not that it has an SDK.
 * So an ONLINE reading proves nothing and the flow continues to the real
 * decision, which is the desktop's.
 * ⚠ What it DOES buy is the OFFLINE case, which is the common one and the one
 * worth short-circuiting: filing a directive against a machine that is provably
 * not listening produces a row nobody will ever claim, a 15-second hold, and a
 * timeout the agent has to interpret. Refusing before the row exists turns that
 * into an immediate, honest answer.
 * ⚠ THE WINDOW IS `PRESENCE_ONLINE_WINDOW_MS`, deliberately reused — a second
 * liveness number would let the roster call a member offline while this path
 * happily filed a directive for them.
 */
// ⚠ EXPORTED SINCE 2026-09-01 for `service-launch-agent.ts` — the SAME question,
// the SAME window, and a second copy would let one lane call a machine online
// while the other filed nothing for it.
export async function operatorIsOnline(
  ctx: ChannelContext
): Promise<boolean> {
  const presence = await collab.presenceForWorkspace(ctx.workspaceId);
  const mine = presence.get(ctx.userId);
  // ⚠ NO ROW AND NO STAMP BOTH READ AS OFFLINE — the fail-safe direction. A
  // presence projection that cannot say when it last heard from a machine is not
  // evidence the machine is up, and the cost of being wrong this way is one
  // honest refusal instead of a directive nobody will ever claim.
  if (!mine?.lastSeenAt) return false;
  // ⚠ Recomputed from the stamp rather than trusting `online`, so this path
  // cannot drift from the window even if that projection is later re-derived.
  const seenAt = Date.parse(mine.lastSeenAt);
  if (Number.isNaN(seenAt)) return false;
  return Date.now() - seenAt < PRESENCE_ONLINE_WINDOW_MS;
}
