import "server-only";
import type { ChannelDelivery } from "../types";
import type { DeliveryAckInput } from "../schema-sessions";
import * as repo from "./repository";
import * as repoDelivery from "./repository-delivery";
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
 * The agent id inside a desktop session key, `<channelId>:<taskId>:<agentId>`.
 *
 * ⚠ **`null` FOR THE TWO-SEGMENT FORM, WHICH IS AN OLDER DESKTOP AND A
 * SUPPORTED PEER** (INVARIANTS §13, and the reason `SESSION_KEY_RE` still
 * accepts it). It cannot say which agent it is, so fence (3) cannot ask — the
 * receipt falls back to fences (1) and (2), which is exactly today's behaviour
 * for that build rather than a new refusal aimed at it.
 * ⚠ NOT A SECOND PARSER OF THE KEY FORMAT: it reads the segment the schema's
 * own comment names and nothing else. The desktop owns what a key IS.
 */
function ackAgentId(sessionKey: string): string | null {
  const third = sessionKey.split(":")[2];
  return third !== undefined && third.length > 0 ? third : null;
}

/**
 * Record every receipt in one push. Returns how many actually moved a row.
 *
 * 🔒 **THREE FENCES, AND THE SECOND AND THIRD ARE THE POINT.**
 *
 * **(1) THE CLAIMANT HOLDS THE SESSION IT IS REPORTING FOR.** `ack.sessionKey`
 * must name a session in `reported` — the live set this same push just
 * reconciled into `channel_sessions` under `ctx.userId` — and that session must
 * be in the channel the receipt names. ⚠ **WITHOUT THIS, MEMBERSHIP ALONE WAS
 * THE FENCE**, so any member of a room could stamp `delivery: "woken"` on any
 * `seq` in it. The write is MONOTONIC and `woken` is the top rank, so that stamp
 * is PERMANENT: the machine that actually handled the message cannot correct it,
 * and an orchestrator reading `delivery=woken` acts on a wake that never
 * happened. The rank ordering makes the false claim durable, which is why this
 * has to be closed at the door rather than resolved afterwards.
 *
 * **(2) CHANNEL MEMBERSHIP, ASKED ONCE PER CHANNEL.** Still asked, and not
 * redundant: `reportSessionStates` writes the session set with no membership
 * check of its own, so fence (1) alone would let a machine declare a session in
 * a room it is not in and then report on it. ⚠ It is deliberately NOT "you must
 * be the author" and NOT "you must not be the author": an operator's own agents
 * are fed that operator's own posts (the fan-out ruling of 2026-08-21), so the
 * author's machine is a legitimate reporter.
 *
 * **(3) THE MESSAGE WAS FOR THIS SESSION** (2026-09-02, F-593). Fences (1) and
 * (2) together say *"you hold a live session in that room"* — they say nothing
 * about the MESSAGE. So an operator with any live agent in a channel could
 * stamp `woken` on a `seq` addressed to somebody else's agent, and the same
 * monotonic rank that makes fence (1) necessary makes THAT lie permanent too:
 * `woken` is the top of the scale and the machine that actually handled the
 * message can never correct it. The stored `recipient_agent_ids` is the
 * server's own answer to *"who was this for"*, so the receipt is checked
 * against it.
 *
 * ⚠ **THE THREE STORED VALUES MEAN THREE DIFFERENT THINGS AND ONLY ONE OF THEM
 * REFUSES.** A NON-EMPTY list is the server's authoritative answer — an ack from
 * an agent outside it is skipped. `null` is *"the server did not resolve the
 * agent half; your own parse decided"*, and `[]` is *"this body named no
 * agent"*, which is also what every non-`message` kind stores; refusing on
 * either would break the lanes the desktop legitimately delivers on its own
 * (`service-wake-verdict.ts` is built around exactly this distinction). ⚠ A seq
 * with NO ROW is skipped: a receipt for a message that does not exist is a
 * receipt for nothing.
 *
 * ⚠ **A RECEIPT THAT FAILS ANY FENCE IS SKIPPED, NOT REFUSED.** Zod
 * validates the ARRAY on this endpoint, and throwing here would take the whole
 * session push down with it — the unretryable 400 that leaves `read_sessions`
 * answering `[]` for a machine's LIVE sessions. The session set is the
 * projection an entire tool reads; a receipt is a convenience beside it, and it
 * loses the tie.
 */
export async function recordDeliveryAcks(
  ctx: ChannelContext,
  acks: readonly DeliveryAckInput[],
  // ⚠ THE SAME PUSH'S SESSION SET, ALREADY WRITTEN. Passed rather than re-read:
  // the route reconciles it immediately before calling this, own-scoped to
  // `ctx.userId` + `ctx.workspaceId`, so it IS "this caller's fresh
  // `channel_sessions`" and asking the database again would answer the same
  // rows one round trip later.
  reported: readonly { sessionKey: string; channelId: string }[]
): Promise<{ stamped: number }> {
  if (acks.length === 0) return { stamped: 0 };

  const ownSessions = new Map(reported.map((s) => [s.sessionKey, s.channelId]));

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

  // ⚠ ONE READ PER DISTINCT MESSAGE, memoized on the promise for the same
  // reason `isMember` is: a machine reporting several receipts for one seq must
  // not pay for several.
  const recipients = new Map<string, Promise<string[] | null | undefined>>();
  const recipientAgentIds = (
    channelId: string,
    seq: number
  ): Promise<string[] | null | undefined> => {
    const key = `${channelId}:${seq}`;
    const held = recipients.get(key);
    if (held) return held;
    const asked = repoDelivery.findRecipientAgentIds(ctx.workspaceId, channelId, seq);
    recipients.set(key, asked);
    return asked;
  };

  let stamped = 0;
  for (const ack of acks) {
    // ⚠ THE CHANNEL MUST MATCH THE SESSION'S OWN, not merely be a room the
    // caller is in — a live session in room A does not license a receipt in
    // room B.
    if (ownSessions.get(ack.sessionKey) !== ack.channelId) continue;
    if (!(await isMember(ack.channelId))) continue;
    const addressed = await recipientAgentIds(ack.channelId, ack.seq);
    if (addressed === undefined) continue;
    const claimant = ackAgentId(ack.sessionKey);
    if (
      addressed !== null &&
      addressed.length > 0 &&
      claimant !== null &&
      !addressed.includes(claimant)
    ) {
      continue;
    }
    const moved = await repoDelivery.stampDelivery(
      ctx.workspaceId,
      ack.channelId,
      ack.seq,
      ack.delivery,
      weakerOrEqual(ack.delivery)
    );
    if (moved) stamped += 1;
  }
  return { stamped };
}
