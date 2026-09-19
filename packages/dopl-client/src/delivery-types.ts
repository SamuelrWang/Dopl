/**
 * THE DELIVERY CONTRACT — the `delivery=` verdict that IS the acknowledgement,
 * and the recipient resolution behind it (2026-09-02).
 *
 * ⚠ **HAND-MAINTAINED MIRRORS of `src/features/channels/types.ts`**, which is the
 * original and carries the argument for every value; this package cannot import
 * that tree (INVARIANTS §13). ⚠ **ITS OWN FILE** because `channel-types.ts` sits
 * AT the 500-line cap and these two unions have their own reason to change: the
 * delivery contract, not a channel shape.
 */

/**
 * WHO the server resolved a message for, decided once at write time.
 * ⚠ Mirror of `src/features/channels/types.ts › ChannelWakeVerdict`.
 * ⚠ The last three are the RESILIENCE arms (B1): the server repaired an address
 * the author did not write, and a reader that cannot see the repair cannot
 * explain the delivery. The original carries the argument.
 */
export type ChannelWakeVerdict =
  | "none"
  | "member"
  | "agent"
  | "thread"
  /** RR1 — a threaded reply with no `to`, resolved to the thread's other party. */
  | "thread_peer"
  /** 🔴 RR2, DELETED 2026-09-18 — A TOMBSTONE for rows written before it. Nothing
   *  produces this; an agent addresses somebody or files a record. Do not add a
   *  producer. */
  | "reciprocal"
  /** RR3 — an unaddressed human message, resolved to the channel's default
   *  responder or to the room's one live agent. */
  | "responder"
  /** `to=@desktop` — the author's OWN operator's OUTSIDE SESSIONS. ⚠ Not a weak
   *  `member`: it notifies nobody and wakes nothing, and the recipient rides
   *  `metadata.to_desktop` rather than `recipient_user_ids`. */
  | "desktop";

/**
 * WHAT HAPPENED to a message — the `delivery=` verdict that IS the
 * acknowledgement. The server stamps its write-time answer; the operator's
 * machine overwrites it with what it did.
 * ⚠ Mirror of `src/features/channels/types.ts › ChannelDelivery`.
 */
export type ChannelDelivery =
  | "none"
  | "unreachable"
  | "idle"
  | "delivered"
  | "woken"
  | "refused"
  /** It is in the room, addressed to `@desktop`, and nothing was started. ⚠ The
   *  one word that is true without a presence system — never `held`, never
   *  `woken`. No machine reports it. */
  | "posted";
