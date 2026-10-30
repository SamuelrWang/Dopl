import type { ChannelDelivery, ChannelWakeVerdict } from "../types";
import type { ResponderReason } from "../lib/agent-mentions";

/**
 * The verdict's wire shapes — what `resolveWakeVerdict` answers, what the write path hands it,
 * and the delivery each verdict word predicts. Split out of `service-wake-verdict.ts`
 * (2026-10-29, 500-line cap); that file still decides PRECEDENCE and re-exports these.
 */
export interface WakeVerdictResult {
  verdict: ChannelWakeVerdict;
  /** ⚠ `null` = NOT RESOLVED HERE, and the desktop then falls back to its own
   *  body parse. `[]` = resolved to nobody. Never collapse the two. */
  recipientUserIds: string[] | null;
  recipientAgentIds: string[] | null;
  /** The server's write-time answer to "what happened". A prediction until the
   *  machine acks. */
  delivery: ChannelDelivery;
  /**
   * **WHY THIS AGENT AND NOT ANOTHER**, when the server CHOSE one the author did
   * not name — RR3's arm, as a word (2026-09-04).
   *
   * ⚠ `null` FOR EVERY ADDRESS THE AUTHOR WROTE: a reason beside a handle
   * somebody typed would invite a reader to think the server had picked. Stamped
   * into `metadata.wake_reason` on the write path and rendered by the read.
   */
  reason: ResponderReason | null;
}

/**
 * The stored `delivery` a verdict predicts, before any machine has spoken.
 *
 * ⚠ **THE THREE RESILIENCE ARMS PREDICT THE SAME OUTCOME AS THE ADDRESS THEY
 * REPAIRED, NOT A WEAKER ONE.** RR1 and RR2 resolve a MEMBER, so `delivered`;
 * RR3 resolves an AGENT, so `woken`. Predicting `idle` for them would understate
 * a wake that is about to happen, and `delivery=` is the one ack an orchestrator
 * acts on.
 */
// ⚠ `reciprocal` IS UNREACHABLE SINCE 2026-09-18 (RR2 is deleted) and its row stays because the
// TYPE still names the word for old rows. A `Record` over the union cannot omit it.
export const DELIVERY_FOR: Record<ChannelWakeVerdict, ChannelDelivery> = {
  none: "none",
  member: "delivered",
  agent: "woken",
  thread: "idle",
  thread_peer: "delivered",
  reciprocal: "delivered",
  responder: "woken",
  // ⚠ `posted` MAY NEVER BECOME `woken`/`delivered` — both claim a REACH, and
  // nothing here sees whether an outside session holds. F-740.
  desktop: "posted",
};


/** What the write path knows that the metadata fold does not. */
export interface WakeVerdictContext {
  /** `user` or `agent`, already derived from the CREDENTIAL in
   *  `service-writes.ts` — never from the body. RR2 and RR3 are the same
   *  situation split by this one fact. */
  authorKind: string;
  /**
   * The agents `to=` resolved to (`service-writes-metadata-recipient.ts ›
   * resolveToRecipients`). `[]` for every post that named none.
   *
   * ⚠ **A LIST SINCE 2026-09-18** (Samuel: *"agents might need to respond to
   * multiple agents … and it could be multiple people on the channel"*). Each id
   * is stored on `recipient_agent_ids`, and the desktop wakes each of them ONCE
   * — the intersection in `main/session-dispatch.js › serverAddressed` already
   * de-dupes, and this list is de-duped at the door.
   */
  toAgentIds: string[];
  /**
   * The members `to=` resolved to. `[]` when none were named.
   *
   * ⚠ **IT IS NOT `metadata.to_user_id`, AND THE DIFFERENCE IS THE POINT.** That
   * key is ONE member — the consent card's and the thread inheritance's index —
   * and is the FIRST of these. `recipient_user_ids` stores all of them, which is
   * what every machine routes on (`serverNamesMember`).
   */
  toUserIds: string[];
  /** **THE OPERATORS `to=@desktop` NAMED** (2026-09-18); `[]` for almost every
   *  post. ⚠ **NEVER FOLD IT INTO `toUserIds`** — that becomes
   *  `recipient_user_ids`, which every machine routes on. INVARIANTS §5. */
  toDesktopOperatorIds: string[];
  /** A legacy thread tag the poster was not entitled to was dropped
   *  (`service-writes-metadata.ts › PostMetadataResult.threadTagStripped`). */
  threadTagStripped?: boolean;
  /**
   * **THE MEMBER HANDLES THIS ROOM ALREADY OCCUPIES**, so the agent namespace mints around them
   * (2026-09-07 — members outrank agents, Samuel's suffix ruling).
   *
   * ⚠ **IT IS THE METADATA FOLD'S LEFTOVER RATHER THAN A READ OF ITS OWN** —
   * `resolveBodyMentions` already derived these from a roster read this request has paid for
   * (`PostMetadataResult.memberHandles`), so the server's precedence matches the client's at
   * zero extra cost. Asking for it here would be two reads on the hot write path.
   *
   * ⚠ **ABSENT IS TODAY'S BEHAVIOUR, NOT A FAILURE** — see `resolveAgentRecipients`.
   */
  reservedHandles?: readonly string[];
}
