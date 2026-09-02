/**
 * THE DELIVERY CONTRACT AND THE POSTURE CEILING (2026-09-02, v2 wave A slice A9).
 *
 * ⚠ **ITS OWN FILE (§1) BECAUSE `types.ts` REACHED THE 500-LINE CAP**, and the
 * seam is real rather than arithmetic: everything here changes when the DELIVERY
 * contract or the launch ceiling changes, and `types.ts` when a channel shape
 * does. Same arrangement `types-sessions.ts` / `types-launch.ts` /
 * `types-direction.ts` / `types-ping.ts` already have — **`types.ts` is the
 * barrel and there is no second import path to any of these symbols.**
 */

import type { LaunchMessageMode, LaunchToolMode } from "./types-launch";

/**
 * **WHO THE SERVER RESOLVED A MESSAGE FOR**, computed once at write time by
 * `server/service-wake-verdict.ts › resolveWakeVerdict` and stored on the row.
 *
 * ⚠ **IT IS A RESOLUTION, NOT AN OUTCOME.** {@link ChannelDelivery} is the
 * outcome, and the two are separate because the answers move independently: the
 * recipient of a message never changes, and what a machine did with it does.
 *
 * ⚠ `"thread"` IS NOT A WEAK `"agent"`. It means the post named nobody and
 * carries a thread tag, so it reaches sessions ALREADY working that thread and
 * wakes nothing — the chat case, stated as a value rather than as an absence.
 */
export type ChannelWakeVerdict = "none" | "member" | "agent" | "thread";

/**
 * **WHAT HAPPENED TO A MESSAGE** — the one vocabulary, written by two authors.
 *
 * The SERVER stamps its write-time answer from the {@link ChannelWakeVerdict};
 * the operator's machine later OVERWRITES it with what it actually did and
 * stamps `deliveryAt` with it. ⚠ A `deliveryAt` of `null` means nothing has
 * confirmed the server's answer — it is a prediction, not a receipt.
 *
 * ⚠ **THIS IS THE `delivery=` THE MCP RESULT LINE RENDERS**, and it is the ack:
 * before it existed, four spellings of "reach an agent" had four different acks
 * and one of them (`wake=`) was an echo of what the caller had typed.
 */
export type ChannelDelivery =
  /** Nothing was addressed. */
  | "none"
  /** The body named an agent and it resolved to no live session. */
  | "unreachable"
  /** It reached sessions already on the thread; nobody was woken. */
  | "idle"
  /** It reached its recipient; what runs is that side's decision. */
  | "delivered"
  /** A dormant agent was started on it. */
  | "woken"
  /** The machine declined to feed it — a full queue, or a gate. */
  | "refused";

/**
 * **THE SUBSET A MACHINE MAY REPORT.**
 *
 * ⚠ `none` and `unreachable` are the SERVER'S answers about a message it
 * resolved — "nobody was addressed" and "the agent named does not exist here" are
 * not things a delivery attempt observes. A desktop reports only what it did,
 * and the `Extract` is what makes that a compile-time fact rather than a
 * convention: widening {@link ChannelDelivery} cannot silently widen what a
 * machine is allowed to claim.
 */
export type MachineDelivery = Extract<
  ChannelDelivery,
  "delivered" | "woken" | "idle" | "refused"
>;

/**
 * ⚠ **THREE INDEPENDENT AXES, EACH NULLABLE ON ITS OWN.** A channel may record
 * a chain rule and no mode ceiling, and the server must clamp what it knows
 * without inventing the rest.
 */
export type ChannelAgentPosture = {
  tools: LaunchToolMode | null;
  messages: LaunchMessageMode | null;
  /** May an agent launched here launch further agents? ⚠ `false` REFUSES a
   *  `chain: true` request at creation (G7); a clamped chain would produce an
   *  agent that hits a bound mid-run, after the caller handed it work assuming
   *  workers. `null` = not recorded; the desktop's toggle answers. */
  chain: boolean | null;
};
