/**
 * Client-side status line for MY own outgoing human message, derived purely from
 * the thread events that follow it. ⚠ NO writes, NO acks, and deliberately NO
 * "Received"/"Read": the desktop does not ack a delivery, so claiming one is a
 * lie. Reports only what the transcript proves.
 *
 * ⚠ EVERY MESSAGE RENDERS STANDALONE NOW. This used to note that a message with
 * an explicit `metadata.taskId` grouped into a session card and so never reached
 * this line; the card and its grouper are DELETED (wiring plan Phase 5,
 * 2026-08-18), so the task-linked shape is live rather than merely unit-tested.
 *
 * Pure + deterministic. Its terminal-wins precedence used to MIRROR the grouper's
 * `computeStatus`; with that gone this is the only statement of it left, and
 * {@link calmTerminalStatus} (`lib/calm-terminal.ts`, rehomed in the same change)
 * is what makes the flag reads strictly `=== true`. ⚠ Linkage by the DERIVABLE legacy `task-{channelId}-{seq}` id is
 * party-scoped (step 3) so only the two people in the exchange move my receipt.
 */

import type { ChannelMessage } from "../types";
import { calmTerminalStatus } from "./calm-terminal";

export type ReceiptStatus =
  | "sent"
  | "working"
  | "replied"
  | "declined"
  | "failed"
  | "interrupted"
  | "dropped";

/** The addressed recipient of a message (`metadata.to_user_id`), or null. */
function metaToUserId(message: ChannelMessage): string | null {
  const value = message.metadata.to_user_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The bound task id of a message (`metadata.taskId`), or null. */
function metaTaskId(message: ChannelMessage): string | null {
  const value = message.metadata.taskId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Receipt for MY outgoing human message, derived from later thread events.
 * Null when none should show (not my message, or an unaddressed broadcast).
 */
export function deriveMessageReceipt(
  message: ChannelMessage,
  messages: ChannelMessage[],
  currentUserId: string,
): ReceiptStatus | null {
  // 1. Only MY own human message gets a receipt.
  if (message.authorKind !== "user" || message.authorUserId !== currentUserId) {
    return null;
  }

  // 2. An unaddressed broadcast never routed to anyone — nothing to report.
  const toUser = metaToUserId(message);
  const taskId = metaTaskId(message);
  if (toUser === null && taskId === null) return null;

  // 3. The deterministic legacy id the desktop spawner would mint for a task
  //    opened by THIS message, plus who is entitled to speak on it.
  //
  //    ⚠ That id is DERIVABLE by any channel member (the DTO exposes `seq`) and
  //    the server does NOT gate a non-UUID `taskId` on participation, so string
  //    equality alone lets a third member stamp a red "Failed" or a fake
  //    "Replied" onto someone else's request. A legacy exchange has exactly two
  //    parties: me, and the addressee whose desktop mints the id. ⚠ Client-side
  //    render defence only — the row is still stored.
  const legacyId = `task-${message.channelId}-${message.seq}`;
  const isExchangeParty = (m: ChannelMessage): boolean =>
    m.authorUserId !== null &&
    (m.authorUserId === currentUserId || m.authorUserId === toUser);

  // 4. Later events linked to this message: shared explicit task id, the legacy
  //    deterministic id, or an addressed agent reply back to me (the pair-reply
  //    a terminal-mode session self-posts without a task id).
  //    ⚠ The no-taskId pair-reply binds to the NEAREST PRECEDING ask — without
  //    that scoping one reply lights up "Replied" on every stacked ask before it.
  const linked = messages.filter((m) => {
    if (m.seq <= message.seq) return false;
    const mTask = metaTaskId(m);
    if (taskId !== null && mTask === taskId) return true;
    if (mTask === legacyId && isExchangeParty(m)) return true;
    return (
      toUser !== null &&
      m.kind === "message" &&
      m.authorKind === "agent" &&
      m.authorUserId === toUser &&
      metaToUserId(m) === currentUserId &&
      !messages.some(
        (x) =>
          x.seq > message.seq &&
          x.seq < m.seq &&
          x.kind === "message" &&
          x.authorKind === "user" &&
          x.authorUserId === currentUserId &&
          metaToUserId(x) === toUser,
      )
    );
  });

  // 5. Terminal-wins precedence, mirroring `computeStatus`: a calm ending or a
  //    real failure beats a delivered reply, which beats a bare "started".
  if (linked.some((m) => calmTerminalStatus(m) === "declined")) return "declined";
  if (linked.some((m) => calmTerminalStatus(m) === "dropped")) return "dropped";
  if (linked.some((m) => calmTerminalStatus(m) === "interrupted")) {
    return "interrupted";
  }
  if (linked.some((m) => m.kind === "task_failed" && calmTerminalStatus(m) === null)) {
    return "failed";
  }
  if (
    linked.some(
      (m) =>
        (m.kind === "message" && m.authorKind === "agent") ||
        m.kind === "task_finished",
    )
  ) {
    return "replied";
  }
  if (linked.some((m) => m.kind === "task_started")) return "working";
  return "sent";
}

/** Label for a receipt status. ⚠ No fabricated acks. */
export const RECEIPT_LABEL: Record<ReceiptStatus, string> = {
  sent: "Sent",
  working: "Accepted, agent working",
  replied: "Replied",
  declined: "Declined",
  failed: "Failed",
  interrupted: "Interrupted",
  dropped: "Reply not sent",
};

/** Calm receipt terminals — operator-chosen endings keeping the muted chip
 *  treatment, ⚠ never the alarm ink of a real `failed`. */
const CALM_RECEIPT_STATUSES: ReadonlySet<ReceiptStatus> = new Set([
  "declined",
  "dropped",
  "interrupted",
]);

/** True for the calm receipt terminals (declined/dropped/interrupted). */
export function isCalmReceiptStatus(status: ReceiptStatus): boolean {
  return CALM_RECEIPT_STATUSES.has(status);
}
