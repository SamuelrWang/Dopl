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
 */
export type ChannelWakeVerdict = "none" | "member" | "agent" | "thread";

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
  | "refused";
