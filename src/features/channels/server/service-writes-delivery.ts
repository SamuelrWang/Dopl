import "server-only";
import type { ChannelDelivery } from "../types";
import type { DeliveryAckInput } from "../schema-sessions";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import type { ChannelContext } from "./service-shared";

/**
 * **THE WAKE ACK — WHAT A MACHINE ACTUALLY DID WITH A MESSAGE** (2026-09-02, A9;
 * guardrails G11/G15, and the half of F9 that was never on the wire).
 *
 * ⚠ **THIS IS THE SECOND HALF OF `delivery=`, AND WITHOUT IT THE FIRST HALF IS A
 * PREDICTION.** `service-wake-verdict.ts` stamps what the SERVER resolved; this
 * stamps what the operator's machine did. An `@agent-<id>` used to be a wake the
 * server could not confirm — the token was parsed on the desktop and nothing
 * crossed back — so an orchestrator that redirected an agent could not tell "it
 * landed and the agent is on it" from "it landed on nobody", and the two need
 * opposite next actions.
 *
 * ⚠ **IT RIDES THE SESSION-HEALTH PUSH RATHER THAN A LANE OF ITS OWN.** That
 * push already exists, already carries this machine's identity and already fires
 * on state change (`main/session-state-push.js`); a second endpoint would be a
 * second credential path, a second retry policy and a second thing to keep
 * alive. The receipts are OPTIONAL on that body, so every installed desktop goes
 * on posting exactly what it posts today.
 *
 * ⚠ **IT IS NOT AN AUTHORITY ON WHETHER AN AGENT IS RUNNING.** It reports one
 * DELIVERY ATTEMPT. A `refused` says this machine did not feed the turn, not
 * that nobody did — which is why the write is monotonic (see below) rather than
 * last-writer-wins.
 */

/**
 * **HOW LOUD AN OUTCOME IS**, ascending. The ONE ordering, and the only place
 * this vocabulary is ranked.
 *
 * ⚠ **IT IS NOT A SEVERITY SCALE, IT IS "HOW FAR DID THIS MESSAGE GET".** That
 * is the question an orchestrator asks, and it is why `refused` outranks
 * `none`: `none` means nobody was addressed, and `refused` means somebody was
 * and a machine turned it away — the second is strictly more news.
 *
 * ⚠ **MONOTONICITY IS THE REASON IT EXISTS.** Two operators can both hold live
 * agents on one thread, so two machines can both report on one message. Without
 * a rank, the second to push would overwrite the first — and the machine that
 * fed nothing is exactly as likely to be second as the one that woke an agent.
 */
const DELIVERY_RANK: Record<ChannelDelivery, number> = {
  none: 0,
  unreachable: 1,
  refused: 2,
  idle: 3,
  delivered: 4,
  woken: 5,
};

/** Every outcome a receipt of `delivery` is allowed to overwrite — itself
 *  included, so a repeated push is idempotent rather than a no-op that reads as
 *  a lost receipt. */
export function weakerOrEqual(delivery: ChannelDelivery): ChannelDelivery[] {
  const ceiling = DELIVERY_RANK[delivery];
  return (Object.keys(DELIVERY_RANK) as ChannelDelivery[]).filter(
    (d) => DELIVERY_RANK[d] <= ceiling
  );
}

/**
 * Record every receipt in one push. Returns how many actually moved a row.
 *
 * ⚠ **THE FENCE IS CHANNEL MEMBERSHIP, ASKED ONCE PER CHANNEL.** A receipt is a
 * claim about a room, so the claimant has to be in it; `(channel_id, seq)` in
 * the statement then makes a mismatched pair update nothing rather than reach a
 * room the caller cannot see. ⚠ It is deliberately NOT "you must be the author"
 * and NOT "you must not be the author": an operator's own agents are fed that
 * operator's own posts (the fan-out ruling of 2026-08-21), so the author's
 * machine is a legitimate reporter.
 *
 * ⚠ **A RECEIPT FOR A ROOM THE CALLER IS NOT IN IS SKIPPED, NOT REFUSED.** Zod
 * validates the ARRAY on this endpoint, and throwing here would take the whole
 * session push down with it — the unretryable 400 that leaves `read_sessions`
 * answering `[]` for a machine's LIVE sessions. The session set is the
 * projection an entire tool reads; a receipt is a convenience beside it, and it
 * loses the tie.
 */
export async function recordDeliveryAcks(
  ctx: ChannelContext,
  acks: readonly DeliveryAckInput[]
): Promise<{ stamped: number }> {
  if (acks.length === 0) return { stamped: 0 };

  // ⚠ ONE membership read per DISTINCT channel, memoized on the promise — a
  // machine reporting eight receipts for one room must not pay for eight.
  const membership = new Map<string, Promise<boolean>>();
  const isMember = (channelId: string): Promise<boolean> => {
    const held = membership.get(channelId);
    if (held) return held;
    const asked = repo
      .findMembership(channelId, ctx.userId)
      .then((row) => row !== null);
    membership.set(channelId, asked);
    return asked;
  };

  let stamped = 0;
  for (const ack of acks) {
    if (!(await isMember(ack.channelId))) continue;
    const moved = await repoMessages.stampDelivery(
      ack.channelId,
      ack.seq,
      ack.delivery,
      weakerOrEqual(ack.delivery)
    );
    if (moved) stamped += 1;
  }
  return { stamped };
}
