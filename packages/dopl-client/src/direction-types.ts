/**
 * THE PRIVATE DIRECT LANE's types — an operator's external agent steering that
 * operator's OWN running agent session (2026-08-31).
 *
 * ⚠ Their own module, `launch-types.ts`'s arrangement and reason: `channel-types.ts`
 * is at the 500-line cap and these describe a mailbox rather than a channel.
 *
 * ⚠ THEY ARE A HAND MIRROR of `src/features/channels/types-direction.ts`, which is
 * where every rule about them is STATED. Nothing here may restate one — a rule in
 * two places drifts in one of them, and you cannot tell which from the outside.
 */

/**
 * ⚠ **{@link DirectionRefusalReason} IS DECLARED IN `@dopl/contracts ›
 * directives.ts` AND RE-EXPORTED HERE** (2026-09-02, v2 slice A13) — it was a
 * hand mirror of `src/features/channels/types-direction.ts` and nothing compared
 * the two. No consumer import changed.
 */
import type { DirectionRefusalReason } from "@dopl/contracts";

export type { DirectionRefusalReason };


/** One private direction, as the server reports it. `status` already has lazy
 *  expiry applied and may differ from the stored column. */
export interface AgentDirection {
  id: string;
  /** Always the reader's own id — every read is fenced on it server-side. */
  operatorUserId: string;
  channelId: string;
  threadId: string | null;
  /** The agent instance this is aimed at. Required at create; there is no
   *  oldest-agent fallback on this lane. */
  agentId: string;
  /**
   * 🔒 WHICH of the operator's own agents FILED this — **an UNVERIFIED LABEL**
   * (F-376a, 2026-08-31). Server-derived from `X-Dopl-Session-Id`, a documented
   * NON-authorization header that anything holding the operator's device token
   * can set; **nothing may gate, route, filter or authorize on it**, here or in
   * any consumer. `null` for an external orchestrator, which sends no session
   * stamp — that is the ORDINARY case, not a defect, and renders as "your agent".
   * ⚠ OPTIONAL on the type as well, because a deployment where the column has not
   * replayed answers rows without the key at all.
   */
  senderAgentId?: string | null;
  body: string;
  status: "pending" | "claimed" | "delivered" | "refused" | "expired";
  refusalReason: DirectionRefusalReason | null;
  /**
   * The directed turn's FINAL TEXT.
   *
   * ⚠ `null` MEANS "NOT REPORTED", NEVER "THE AGENT SAID NOTHING" — an empty final
   * text and a desktop older than the capture are both honest deliveries.
   */
  reply: string | null;
  claimedAt: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

/** ⚠ NO `operatorUserId`, AND THERE MUST NEVER BE ONE. The server stamps the
 *  authenticated caller; the absence of the field is the authorization story. */
export interface AgentDirectionCreateInput {
  /** Slug or id. */
  channel: string;
  agentId: string;
  threadId?: string;
  body: string;
  /**
   * **AN IDEMPOTENCY KEY — "a retry may not say this twice"** (2026-09-02,
   * A10/G10).
   *
   * ⚠ `LaunchDirectiveCreateInput.clientMsgId`'s contract exactly, and that type
   * carries the argument. The hazard here is the mirror image: a second direction
   * reaches a LIVE agent, which answers twice, and neither side can tell which
   * answer belonged to which request.
   * ⚠ A converged retry returns the stored row `reply` INCLUDED, so a caller
   * whose hold timed out collects the answer instead of asking again.
   */
  clientMsgId?: string;
}

/**
 * ⚠ **`existing: true` MEANS THIS CALL FILED NOTHING** (2026-09-02, A10/G10) —
 * the `clientMsgId` had been used before and this is the FIRST request's
 * direction, whatever became of it.
 * ⚠ OPTIONAL, because a server older than this wave sends no such key
 * (INVARIANTS §13); absent reads as `false`, which is right there — that server
 * stored no key and every call really was fresh.
 */
export type AgentDirectionCreated =
  | { offline: true; direction: null }
  | { offline: false; direction: AgentDirection; existing?: boolean };
