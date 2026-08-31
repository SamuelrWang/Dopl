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
 * WHY A DESKTOP SAID NO TO A DIRECTION — exactly five words, the wire contract.
 *
 *  - `no-session` — no live agent with that id on that machine. The one that
 *                   actually happens, and the only authoritative answer: whether
 *                   an agent is alive is knowable only where it runs.
 *  - `auth-hold`  — the desktop is signed out; the session has no query to feed.
 *  - `busy`       — declined for now. Genuinely temporary.
 *  - `blocked`    — the desktop is below the version floor.
 *  - `no-bridge`  — the operator's direct-over-MCP toggle is OFF. A CHOICE, not a
 *                   fault; the render must not read as one.
 */
export type DirectionRefusalReason =
  | "no-session"
  | "auth-hold"
  | "busy"
  | "blocked"
  | "no-bridge";

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
}

export type AgentDirectionCreated =
  | { offline: true; direction: null }
  | { offline: false; direction: AgentDirection };
